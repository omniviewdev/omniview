import { findByKey } from './open';
import { repairHistory, type Context } from './resolve';
import { sameRoute } from './route';
import { closedEntry, freshId, historyOf, makeTab, patch, pinnedCount, refuse, show, unchanged, withTab, type Step } from './state';
import {
  LIMITS,
  type Availability,
  type ClosedTab,
  type CloseResult,
  type CloseScope,
  type Guard,
  type ReopenCheck,
  type ReopenOptions,
  type Tab,
  type TabId,
  type TabResult,
  type TabsState,
} from './types';

// Closing and reopening (ch16 S30, S41 to S43, S37), and the guard for unsaved changes (S27): a request that would discard a draft is answered `confirm` until it is repeated
// with `confirmed: true`.

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high));

const without = <T extends Record<string, unknown>>(map: Readonly<Record<string, T>>, drop: ReadonlySet<string>): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    if (!drop.has(key)) {
      out[key] = value;
    }
  }

  return out;
};

/**
 * Closes tabs in one step: each goes to the closed list in strip order with the index it had when its turn came, so reopening newest first rebuilds the strip (ch16 S42, S43). The last tab
 * closes like any other and leaves the strip empty: no page opens by itself (decision A17, see `ensureHome`). A tab that is moving to another window (`detach`) is not recorded: it is not closed.
 */
function closeTabs(state: TabsState, ids: readonly TabId[], record = true): Step<CloseResult> {
  const closing = new Set(ids.filter((id) => state.tabs[id] !== undefined));
  if (closing.size === 0) {
    return unchanged(state);
  }

  const records: ClosedTab[] = [];
  const survivors: TabId[] = [];
  state.order.forEach((id, original) => {
    const tab = state.tabs[id];
    if (tab && closing.has(id)) {
      records.push(closedEntry(tab, original - records.length));
    } else {
      survivors.push(id);
    }
  });

  const was = state.active;
  const at = was === null ? -1 : state.order.indexOf(was);
  const neighbour = was !== null && closing.has(was)
    ? (state.order.slice(at + 1).find((id) => !closing.has(id)) ?? state.order.slice(0, at).reverse().find((id) => !closing.has(id)) ?? null)
    : was;
  const next = patch(state, {
    tabs: Object.freeze(without(state.tabs, closing)),
    order: Object.freeze(survivors),
    mounted: Object.freeze(state.mounted.filter((id) => !closing.has(id))),
    closed: record ? Object.freeze([...records.slice().reverse(), ...state.closed].slice(0, LIMITS.closed)) : state.closed,
    active: neighbour === was ? was : null,
  });
  const shown = neighbour !== was && neighbour !== null ? show(next, neighbour) : next;
  return { state: shown, result: { status: 'done', closed: records.map((entry) => entry.id), active: shown.active } };
}

/** The unsaved tabs among `ids`, in strip order: what a batch asks about once. */
const unsavedAmong = (state: TabsState, ids: readonly TabId[]): TabId[] => ids.filter((id) => state.tabs[id]?.flags.unsaved);

function closeGuarded(state: TabsState, ids: readonly TabId[], guard: Guard, record = true): Step<CloseResult> {
  const dirty = unsavedAmong(state, ids);
  return dirty.length > 0 && guard.confirmed !== true ? { state, result: { status: 'confirm', action: 'close', tabs: dirty } } : closeTabs(state, ids, record);
}

export function close(state: TabsState, id: TabId | null, guard: Guard = {}): Step<CloseResult> {
  if (id === null || !state.tabs[id]) {
    return refuse(state, 'missing', `There is no tab ${id ?? ''} to close.`);
  }

  return closeGuarded(state, [id], guard);
}

/** A tab that now lives in another window: gone from this strip, and not offered under Recently closed here (it would be in two windows). */
export function detach(state: TabsState, id: TabId, guard: Guard = {}): Step<CloseResult> {
  return closeGuarded(state, [id], guard, false);
}

/** The tabs a close others, to the right, to the left or all but pinned would close (ch16 S42): pinned tabs are skipped. */
export function closeSet(state: TabsState, scope: CloseScope, id: TabId): readonly TabId[] {
  const at = state.order.indexOf(id);
  const free = (other: TabId) => !(state.tabs[other]?.flags.pinned);
  return scope === 'others'
    ? state.order.filter((other) => other !== id && free(other))
    : scope === 'right'
      ? state.order.slice(at + 1).filter(free)
      : scope === 'left'
        ? state.order.slice(0, at).filter(free)
        : state.order.filter(free);
}

/** Close others, to the right, to the left, all but pinned (ch16 S42): pinned tabs are skipped, and unsaved tabs ask once for the batch. */
export function closeMany(state: TabsState, scope: CloseScope, id: TabId | null, guard: Guard = {}): Step<CloseResult> {
  if (id === null || !state.order.includes(id)) {
    return refuse(state, 'missing', 'There is no tab to close the others of.');
  }

  const ids = closeSet(state, scope, id);
  return ids.length === 0 ? unchanged(state) : closeGuarded(state, ids, guard);
}

/** Every tab of a plugin: an uninstall closes them, and they are offered under Recently closed (ch16 S136). */
export function closePlugin(state: TabsState, plugin: string, guard: Guard = {}): Step<CloseResult> {
  const ids = state.order.filter((id) => state.tabs[id]?.location.route.plugin === plugin);
  return ids.length === 0 ? unchanged(state) : closeGuarded(state, ids, guard);
}

const why = (entry: ClosedTab, availability: Extract<Availability, { readonly state: 'unavailable' }>): string =>
  availability.reason.startsWith(entry.face.title) ? availability.reason : `${entry.face.title}: ${availability.reason}`;

/** The closed tabs a request can name: the one it names, else all. */
const candidatesOf = (state: TabsState, options: ReopenOptions): readonly ClosedTab[] => (options.id === undefined ? state.closed : state.closed.filter((entry) => entry.id === options.id));

/** Whether a closed tab can come back, and if not why: no tab was closed, or its plugin cannot serve the one that was (ch16 CR3). */
export function canReopen(state: TabsState, ctx: Context, options: ReopenOptions = {}): ReopenCheck {
  const candidates = candidatesOf(state, options);
  if (candidates.length === 0) {
    return { ok: false, reason: 'nothing-closed', message: 'There are no recently closed tabs' };
  }

  let first: string | undefined;
  for (const entry of candidates) {
    const availability = ctx.plugins.availability(entry.location.route);
    if (availability.state !== 'unavailable') {
      return { ok: true };
    }

    first ??= why(entry, availability);
  }

  return { ok: false, reason: 'unavailable', message: first ?? '' };
}

function bringBack(state: TabsState, ctx: Context, entry: ClosedTab, route: ClosedTab['location']['route']): Step<TabResult> {
  const looked = ctx.plugins.look(route);
  const same = sameRoute(route, entry.location.route);
  const face = looked.described || !same ? looked.face : entry.face;
  const key = looked.described || !same ? looked.key : entry.location.key;
  const base = patch(state, { closed: Object.freeze(state.closed.filter((other) => other !== entry)) });
  if (face.singleton) {
    const hit = findByKey(base, key);
    if (hit) {
      return { state: show(base, hit.id), result: { status: 'done', id: hit.id } };
    }
  }

  const id = base.tabs[entry.id] === undefined ? entry.id : freshId(base, ctx.newId);
  const history = repairHistory(entry.history, route, (other) => ctx.plugins.restore(other));
  const tab = makeTab({ id, route, key, face, history, pageState: same ? entry.pageState : null, flags: { pinned: entry.pinned } });
  const pinned = pinnedCount(base);
  const index = entry.pinned ? clamp(entry.index, 0, pinned) : clamp(entry.index, pinned, base.order.length);
  const order = [...base.order.slice(0, index), id, ...base.order.slice(index)];
  const next = show(patch(withTab(base, tab), { order: Object.freeze(order) }), id);
  return { state: next, result: { status: 'done', id } };
}

/**
 * Brings back the newest closed tab, or the one named, at the index it had (clamped, and inside the pinned zone for a pinned tab); a singleton that is open again is shown instead
 * (ch16 S43). A tab whose plugin cannot serve it now stays in the list: without a name the newest one that can open is used; a named one is refused with the reason. A tab its
 * plugin drops when asked to restore it is removed from the list.
 */
export function reopen(state: TabsState, ctx: Context, options: ReopenOptions = {}): Step<TabResult> {
  const candidates = candidatesOf(state, options);
  if (candidates.length === 0) {
    return refuse(state, options.id === undefined ? 'nothing-closed' : 'missing', 'There are no recently closed tabs.');
  }

  let remaining = state;
  let refusal: string | undefined;
  for (const entry of candidates) {
    const availability = ctx.plugins.availability(entry.location.route);
    if (availability.state === 'unavailable') {
      refusal ??= why(entry, availability);
      continue;
    }

    const route = ctx.plugins.restore(entry.location.route);
    if (route !== false) {
      return bringBack(remaining, ctx, entry, route);
    }

    remaining = patch(remaining, { closed: Object.freeze(remaining.closed.filter((other) => other !== entry)) });
    if (options.id !== undefined) {
      return { state: remaining, result: { status: 'refused', reason: 'dropped', message: `${entry.face.title} cannot be restored.` } };
    }
  }

  const result: TabResult = refusal === undefined
    ? { status: 'refused', reason: 'nothing-closed', message: 'There are no recently closed tabs.' }
    : { status: 'refused', reason: 'unavailable', message: refusal };
  return { state: remaining, result };
}

/** A new tab on the route of `id`, right of it, in the foreground, with a history of its own that starts there and no page state (ch16 S37). A singleton cannot be duplicated. */
export function duplicate(state: TabsState, ctx: Context, id: TabId | null): Step<TabResult> {
  const tab: Tab | undefined = id === null ? undefined : state.tabs[id];
  if (!tab) {
    return refuse(state, 'missing', 'There is no tab to duplicate.');
  }

  if (tab.face.singleton) {
    return refuse(state, 'singleton', `Only one ${tab.face.title} tab can exist`);
  }

  const looked = ctx.plugins.look(tab.location.route);
  const route = tab.location.route;
  const copy = makeTab({
    id: freshId(state, ctx.newId),
    route,
    key: looked.described ? looked.key : tab.location.key,
    face: looked.described ? looked.face : tab.face,
    history: historyOf([route], 0),
  });
  const index = Math.max(state.order.indexOf(tab.id) + 1, pinnedCount(state));
  const order = [...state.order.slice(0, index), copy.id, ...state.order.slice(index)];
  return { state: show(patch(withTab(state, copy), { order: Object.freeze(order) }), copy.id), result: { status: 'done', id: copy.id } };
}
