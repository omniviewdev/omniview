import { equalJson, lenientJson } from './json';
import { normaliseKeepAlive } from './keepAlive';
import { ensureHome, findByKey } from './open';
import { replaced, stepped, type Context } from './resolve';
import { sameRoute } from './route';
import { applyKeepAlive, changeTab, fits, flagsOf, patch, pinnedCount, refuse, show, staleOrigin, unchanged, withTab, type Step } from './state';
import { LIMITS, type Attention, type HistoryDirection, type HistoryItem, type KeepAlive, type NavigationGuard, type Tab, type TabId, type TabResult, type TabsState } from './types';

// Showing a tab, pinning, reordering, and the small facts a page reports about its tab: its state, its draft, its attention (ch16 S22, S29, S38, S45, S47, S48).
// And a tab's history (S50, S60), and the model describing its tabs again when the plugins changed.

const done = (state: TabsState, id: TabId): Step<TabResult> => ({ state, result: { status: 'done', id } });
const missing = (state: TabsState, id: TabId | null): Step<TabResult> => refuse(state, 'missing', `There is no tab ${id ?? ''}.`);

/** Shows a tab: it leads the mounted pages, and its attention is read (ch16 S22). The tab on screen is already shown. */
export function activate(state: TabsState, id: TabId | null): Step<TabResult> {
  if (id === null || !state.tabs[id]) {
    return missing(state, id);
  }

  const next = show(state, id);
  return next === state ? unchanged(state) : done(next, id);
}

/** Positional, wrapping, in the strip (ch16 S48). */
export function activateOffset(state: TabsState, delta: number): Step<TabResult> {
  const { order, active } = state;
  if (order.length === 0) {
    return missing(state, null);
  }

  if (active === null) {
    return activate(state, (delta < 0 ? order.at(-1) : order[0]) ?? null);
  }

  const at = order.indexOf(active);
  return activate(state, order[(((at + delta) % order.length) + order.length) % order.length] ?? null);
}

/** The Nth tab, counting from 1 (ch16 S47); `goto(0)` and past the end are refused. */
export function goto(state: TabsState, n: number): Step<TabResult> {
  const id = Number.isInteger(n) && n >= 1 ? state.order[n - 1] : undefined;
  return id === undefined ? missing(state, null) : activate(state, id);
}

export const last = (state: TabsState): Step<TabResult> => activate(state, state.order.at(-1) ?? null);

/** Pins or unpins: the tab moves across the pinned boundary, and a preview becomes permanent (ch16 S24, S38). */
export function pin(state: TabsState, id: TabId | null, pinned?: boolean): Step<TabResult> {
  const tab = id === null ? undefined : state.tabs[id];
  if (!tab || id === null) {
    return missing(state, id);
  }

  const want = pinned ?? !tab.flags.pinned;
  if (want === tab.flags.pinned) {
    return unchanged(state);
  }

  return reorder(state, id, pinnedCount(state, state.order.filter((other) => other !== id)), { pinned: want });
}

/**
 * Moves a tab to a final index in the strip, which crosses the pinned boundary only by pinning or unpinning it (ch16 S45): a tab dropped inside the pinned zone is pinned, one dropped
 * after it is not, and `pinned` says what the flag is after the move (a pinned tab dropped past the zone lands at its end). A move makes a preview permanent.
 */
export function reorder(state: TabsState, id: TabId | null, to: number, options: { readonly pinned?: boolean | undefined } = {}): Step<TabResult> {
  const tab = id === null ? undefined : state.tabs[id];
  if (!tab || id === null) {
    return missing(state, id);
  }

  if (!Number.isFinite(to)) {
    return refuse(state, 'invalid', 'The index is not a number.');
  }

  const others = state.order.filter((other) => other !== id);
  const zone = pinnedCount(state, others);
  const wanted = Math.min(Math.max(Math.trunc(to), 0), others.length);
  const pinned = options.pinned ?? (wanted < zone ? true : wanted > zone ? false : tab.flags.pinned);
  const target = pinned ? Math.min(wanted, zone) : Math.max(wanted, zone);
  const index = state.order.indexOf(id);
  if (target === index && pinned === tab.flags.pinned) {
    return unchanged(state);
  }

  const order = [...others.slice(0, target), id, ...others.slice(target)];
  const moved = changeTab(tab, { flags: flagsOf({ ...tab.flags, pinned, preview: false }) });
  return done(patch(withTab(state, moved), { order: order.every((other, i) => other === state.order[i]) ? state.order : Object.freeze(order) }), id);
}

/** A preview tab becomes permanent: on any click or key in the page, a double-click on the tab, pin, a move, or a second navigation (ch16 S24). */
export function keep(state: TabsState, id: TabId | null): Step<TabResult> {
  const tab = id === null ? undefined : state.tabs[id];
  if (!tab || id === null) {
    return missing(state, id);
  }

  return tab.flags.preview ? done(withTab(state, changeTab(tab, { flags: flagsOf({ ...tab.flags, preview: false }) })), id) : unchanged(state);
}

/**
 * What the page on screen keeps, as plain data (`Tab.pageState`): it stays with the tab through a switch, a reload and a reopen, and the history entry the tab leaves keeps it. `true` when it changed. A state
 * over `LIMITS.pageStateBytes` is refused (`false`) and the page keeps the state it had: a tab holds at most 51 of them, so a page cannot grow a tab without a bound.
 */
export function setPageState(state: TabsState, id: TabId, value: unknown): Step<boolean> {
  const tab = state.tabs[id];
  const pageState = lenientJson(value) ?? null;
  if (!tab || equalJson(tab.pageState, pageState) || !fits(pageState)) {
    return { state, result: false };
  }

  return { state: withTab(state, changeTab(tab, { pageState })), result: true };
}

/** The page holds a draft that closing or leaving would discard (ch16 S27). Clearing it may let the cap evict the tab. */
export function setUnsaved(state: TabsState, id: TabId, unsaved: boolean): Step<boolean> {
  const tab = state.tabs[id];
  if (!tab || tab.flags.unsaved === unsaved) {
    return { state, result: false };
  }

  return { state: applyKeepAlive(withTab(state, changeTab(tab, { flags: flagsOf({ ...tab.flags, unsaved }) }))), result: true };
}

/** An operation started here ended badly while the tab was not on screen (ch16 S22). An outcome that ends while the tab is on screen sets nothing. */
export function markAttention(state: TabsState, id: TabId, attention: Attention): Step<boolean> {
  const tab = state.tabs[id];
  if (!tab || id === state.active || tab.flags.attention === attention) {
    return { state, result: false };
  }

  return { state: withTab(state, changeTab(tab, { flags: flagsOf({ ...tab.flags, attention }) })), result: true };
}

/** The page answered a reveal request. `true` when there was one with that number. */
export function consumeReveal(state: TabsState, id: TabId, seq: number): Step<boolean> {
  const tab = state.tabs[id];
  if (tab?.reveal?.seq !== seq) {
    return { state, result: false };
  }

  return { state: withTab(state, changeTab(tab, { reveal: undefined })), result: true };
}

/** Draws the page again without changing where it is (ch16 S44): the generation rises. A tab with unsaved changes asks first. */
export function reload(state: TabsState, id: TabId | null, guard: NavigationGuard = {}): Step<TabResult> {
  if (staleOrigin(state, guard.origin, id)) {
    return refuse(state, 'stale', 'The tab or its location changed.');
  }

  const tab = id === null ? undefined : state.tabs[id];
  if (!tab || id === null) {
    return missing(state, id);
  }

  if (tab.flags.unsaved && guard.confirmed !== true) {
    return { state, result: { status: 'confirm', action: 'reload', tabs: [id] } };
  }

  const reloaded = Object.freeze({ ...tab.location, generation: tab.location.generation + 1 });
  return done(applyKeepAlive(withTab(state, changeTab(tab, { location: reloaded, flags: flagsOf({ ...tab.flags, unsaved: false }) }))), id);
}

export const canGo = (tab: Tab | undefined, direction: HistoryDirection): boolean =>
  tab !== undefined && (direction === 'back' ? tab.history.index > 0 : tab.history.index < tab.history.entries.length - 1);

/** One step in a tab's history (ch16 S50): the page of that entry, given what that page kept when the tab left it, and nothing asked of the page. The page it leaves keeps its state with its entry (H7). Asks about unsaved changes. */
export function step(state: TabsState, ctx: Context, id: TabId | null, direction: HistoryDirection, guard: NavigationGuard = {}): Step<TabResult> {
  if (staleOrigin(state, guard.origin, id)) {
    return refuse(state, 'stale', 'The tab or its location changed.');
  }

  const tab = id === null ? undefined : state.tabs[id];
  if (!tab || id === null) {
    return missing(state, id);
  }

  if (!canGo(tab, direction)) {
    return unchanged(state);
  }

  const index = tab.history.index + (direction === 'back' ? -1 : 1);
  const route = tab.history.entries[index];
  if (!route) {
    return unchanged(state);
  }

  // A singleton page is one tab in the whole app (ch16 S26): the entry that is that page shows the tab that holds it, and this tab stays where it is.
  const looked = ctx.plugins.look(route);
  const elsewhere = looked.face.singleton ? findByKey(state, looked.key, route.kind) : undefined;
  if (elsewhere && elsewhere.id !== id) {
    return done(show(state, elsewhere.id), elsewhere.id);
  }

  if (tab.flags.unsaved && guard.confirmed !== true) {
    return { state, result: { status: 'confirm', action: 'navigate', tabs: [id] } };
  }

  const arrived = stepped(tab.history, index, tab.pageState);
  const moved = changeTab(tab, {
    location: Object.freeze({ route, key: looked.key, generation: tab.location.generation }),
    face: looked.face,
    history: arrived.history,
    pageState: arrived.pageState,
    flags: flagsOf({ ...tab.flags, unsaved: false }),
    reveal: undefined,
  });
  return done(applyKeepAlive(withTab(state, moved)), id);
}

/** The titles in a direction, nearest first, at most 10 (ch16 S50): what a long press on Back lists. */
export function historyList(state: TabsState, ctx: Context, id: TabId | null, direction: HistoryDirection): readonly HistoryItem[] {
  const tab = id === null ? undefined : state.tabs[id];
  if (!tab) {
    return [];
  }

  const items: HistoryItem[] = [];
  const delta = direction === 'forward' ? 1 : -1;
  for (let i = tab.history.index + delta; i >= 0 && i < tab.history.entries.length && items.length < LIMITS.historyList; i += delta) {
    const route = tab.history.entries[i];
    if (route) {
      items.push({ index: i, route, title: ctx.plugins.look(route).face.title });
    }
  }

  return items;
}

/**
 * Describes the tabs again, because what the plugins say changed (a plugin loaded, one left, one was updated): titles, icons, keys and facets. Only what moved is replaced, and
 * nothing at all (the same state) when nothing did. A plugin that says nothing about a tab leaves it as it is. A plugin that now answers another route for a tab moves the tab to it.
 */
export function refresh(state: TabsState, ctx: Context, plugin?: string): TabsState {
  const tabs: Record<TabId, Tab> = {};
  let changed = false;
  for (const id of state.order) {
    const tab = state.tabs[id];
    if (!tab) {
      continue;
    }

    const current = tab.location.route;
    if (plugin !== undefined && current.plugin !== plugin && !(current.kind === 'extension-view' && current.offer.startsWith(`${plugin}/`))) {
      continue;
    }

    const route = ctx.plugins.complete(tab.location.route, undefined, 'refresh') ?? tab.location.route;
    const rerouted = !sameRoute(route, tab.location.route);
    const looked = ctx.plugins.look(route);
    if (!looked.described && !rerouted) {
      continue;
    }

    const face = equalFace(looked.face, tab.face) ? tab.face : looked.face;
    if (!rerouted && face === tab.face && looked.key === tab.location.key) {
      continue;
    }

    changed = true;
    tabs[id] = rerouted
      ? changeTab(tab, { location: Object.freeze({ route, key: looked.key, generation: tab.location.generation }), face, history: replaced(tab.history, route), pageState: null })
      : changeTab(tab, { location: looked.key === tab.location.key ? tab.location : Object.freeze({ ...tab.location, key: looked.key }), face });
  }

  const next = changed ? patch(state, { tabs: Object.freeze({ ...state.tabs, ...tabs }) }) : state;
  return ensureHome(next, ctx);
}

const equalFace = (a: Tab['face'], b: Tab['face']): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A new policy for the mounted pages. It applies at once: the pages beyond the cap are evicted, and raising the cap brings nothing back. */
export function setKeepAlive(state: TabsState, change: Partial<KeepAlive>): Step<boolean> {
  const keepAlive = normaliseKeepAlive(change, state.keepAlive);
  if (keepAlive.cap === state.keepAlive.cap && keepAlive.keepUnsaved === state.keepAlive.keepUnsaved) {
    return { state, result: false };
  }

  return { state: applyKeepAlive(patch(state, { keepAlive })), result: true };
}
