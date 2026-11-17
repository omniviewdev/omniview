import { enforce } from './keepAlive';
import { sameRoute } from './route';
import {
  LIMITS,
  STATE_VERSION,
  type Attention,
  type ClosedTab,
  type Face,
  type Flags,
  type History,
  type Json,
  type KeepAlive,
  type Location,
  type Noop,
  type Refused,
  type RefusedReason,
  type Reveal,
  type Route,
  type Tab,
  type TabId,
  type TabsState,
} from './types';

// The state's shape and the helpers every operation uses. An operation is a function from a state to a new state and a result: it returns the same state object when it
// changed nothing, so the store has nobody to notify (docs/ui-next/optimisations.md HSH-24), and everything it makes is frozen.

/** What an operation answers: the state after it, and what happened. */
export type Step<R> = { readonly state: TabsState; readonly result: R };

export const NOOP: Noop = Object.freeze({ status: 'noop' });
export const unchanged = (state: TabsState): Step<Noop> => ({ state, result: NOOP });
export const refuse = (state: TabsState, reason: RefusedReason, message: string): Step<Refused> => ({ state, result: { status: 'refused', reason, message } });

export function emptyState(keepAlive: KeepAlive): TabsState {
  return Object.freeze({
    version: STATE_VERSION,
    tabs: Object.freeze({}),
    order: Object.freeze([]),
    active: null,
    mounted: Object.freeze([]),
    closed: Object.freeze([]),
    keepAlive,
    serial: 0,
  });
}

/** The state with some of its fields replaced. */
export function patch(state: TabsState, changes: Partial<TabsState>): TabsState {
  return Object.freeze({ ...state, ...changes });
}

export const NO_ATTENTION: Attention = false;

export const flagsOf = (flags: Partial<Flags> = {}): Flags =>
  Object.freeze({ pinned: flags.pinned === true, preview: flags.preview === true && flags.pinned !== true, unsaved: flags.unsaved === true, attention: flags.attention ?? NO_ATTENTION });

export const historyOf = (entries: readonly Route[], index: number): History => Object.freeze({ entries: Object.freeze(entries.slice()), index });

export type TabInput = {
  readonly id: TabId;
  readonly route: Route;
  readonly key: string;
  readonly face: Face;
  readonly generation?: number;
  readonly history?: History;
  readonly flags?: Partial<Flags>;
  readonly pageState?: Json;
  readonly reveal?: Reveal | undefined;
};

export function makeTab(input: TabInput): Tab {
  const place: Location = Object.freeze({ route: input.route, key: input.key, generation: input.generation ?? 0 });
  return Object.freeze({
    id: input.id,
    location: place,
    face: input.face,
    history: input.history ?? historyOf([input.route], 0),
    flags: flagsOf(input.flags),
    pageState: input.pageState ?? null,
    ...(input.reveal ? { reveal: input.reveal } : {}),
  });
}

/** The tab with some of its parts replaced; everything it does not name is the same object. */
export function changeTab(tab: Tab, changes: Partial<Omit<Tab, 'id'>>): Tab {
  const { reveal, ...rest } = { ...tab, ...changes };
  return Object.freeze(reveal ? { ...rest, reveal } : rest);
}

export function withTab(state: TabsState, tab: Tab): TabsState {
  return patch(state, { tabs: Object.freeze({ ...state.tabs, [tab.id]: tab }) });
}

/** A tab id the state has not used and holds no closed tab under, even from a generator that repeats. */
export function freshId(state: TabsState, newId: () => TabId): TabId {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = newId();
    if (id !== '' && state.tabs[id] === undefined && !state.closed.some((entry) => entry.id === id)) {
      return id;
    }
  }

  throw new Error('newId keeps answering ids that are taken');
}

/** How many tabs lead the strip pinned (the pinned zone is never interleaved: ch16 S38). */
export function pinnedCount(state: TabsState, order: readonly TabId[] = state.order): number {
  let count = 0;
  while (count < order.length && (state.tabs[order[count] ?? '']?.flags.pinned)) {
    count += 1;
  }

  return count;
}

export const activeTab = (state: TabsState): Tab | undefined => (state.active === null ? undefined : state.tabs[state.active]);

/** The state with `id` on screen: it leads the mounted pages, attention is read, and the cap evicts from the other end. The same state when it already is. */
export function show(state: TabsState, id: TabId): TabsState {
  const tab = state.tabs[id];
  if (!tab) {
    return state;
  }

  const cleared = tab.flags.attention !== NO_ATTENTION;
  if (state.active === id && state.mounted[0] === id && !cleared) {
    return state;
  }

  const tabs = cleared ? Object.freeze({ ...state.tabs, [id]: changeTab(tab, { flags: flagsOf({ ...tab.flags, attention: NO_ATTENTION }) }) }) : state.tabs;
  const mounted = enforce([id, ...state.mounted.filter((other) => other !== id)], tabs, state.keepAlive);
  return patch(state, { tabs, active: id, mounted });
}

/** The state after the policy: used when a flag or the cap changed what may stay mounted. */
export function applyKeepAlive(state: TabsState): TabsState {
  const mounted = enforce(state.mounted, state.tabs, state.keepAlive);
  return mounted === state.mounted ? state : patch(state, { mounted });
}

export const closedEntry = (tab: Tab, index: number): ClosedTab =>
  Object.freeze({ id: tab.id, location: tab.location, face: tab.face, history: tab.history, pageState: tab.pageState, pinned: tab.flags.pinned, index });

/** Every rule the model keeps, checked against a state: an empty list means it is sound. Used by the tests and by anyone who wants to assert a state they were handed. */
export function checkInvariants(state: TabsState): string[] {
  const bad: string[] = [];
  const ids = Object.keys(state.tabs);
  if (state.version !== STATE_VERSION) {
    bad.push(`the version is ${String(state.version)}`);
  }

  if (new Set(state.order).size !== state.order.length) {
    bad.push('a tab is in the strip twice');
  }

  if (state.order.length !== ids.length || state.order.some((id) => state.tabs[id] === undefined)) {
    bad.push('the strip and the tabs do not list the same tabs');
  }

  if (state.order.length === 0) {
    if (state.active !== null) {
      bad.push('a tab is on screen in an empty strip');
    }
  } else if (state.active === null || !state.order.includes(state.active)) {
    bad.push('the tab on screen is not in the strip');
  }

  checkTabs(state, bad);
  if (state.active !== null && state.mounted[0] !== state.active) {
    bad.push('the tab on screen does not lead the mounted pages');
  }

  if (new Set(state.mounted).size !== state.mounted.length || state.mounted.some((id) => state.tabs[id] === undefined)) {
    bad.push('the mounted pages are not tabs, or are listed twice');
  }

  if (state.keepAlive.cap !== null && (!Number.isInteger(state.keepAlive.cap) || state.keepAlive.cap < 1)) {
    bad.push('the cap is not a whole number of at least one');
  }

  if (state.closed.length > LIMITS.closed) {
    bad.push(`${state.closed.length} closed tabs`);
  }

  if (new Set(state.closed.map((entry) => entry.id)).size !== state.closed.length || state.closed.some((entry) => state.tabs[entry.id] !== undefined)) {
    bad.push('a closed tab shares an id with another closed tab or a tab that is open');
  }

  return bad;
}

function checkTabs(state: TabsState, bad: string[]): void {
  let loose = false;
  let previews = 0;
  const singletons = new Set<string>();
  for (const id of state.order) {
    const tab = state.tabs[id];
    if (!tab) {
      continue;
    }

    if (tab.id !== id) {
      bad.push(`tab ${id} is filed under another id`);
    }

    if (tab.flags.pinned && loose) {
      bad.push(`pinned tab ${id} after an unpinned one`);
    }

    loose ||= !tab.flags.pinned;
    if (tab.flags.preview) {
      previews += 1;
      if (tab.flags.pinned) {
        bad.push(`tab ${id} is pinned and a preview`);
      }
    }

    if (tab.face.singleton) {
      if (singletons.has(tab.location.key)) {
        bad.push(`the singleton ${tab.location.key} is open twice`);
      }

      singletons.add(tab.location.key);
    }

    const { entries, index } = tab.history;
    if (index < 0 || index >= entries.length || entries.length > LIMITS.history) {
      bad.push(`tab ${id}: history out of range`);
    } else if (entries[index] === undefined || !sameRoute(entries[index], tab.location.route)) {
      bad.push(`tab ${id}: the history entry is not its route`);
    }

    if (tab.location.key === '') {
      bad.push(`tab ${id} has no key`);
    }
  }

  if (previews > 1) {
    bad.push(`${previews} preview tabs`);
  }
}
