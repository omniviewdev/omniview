import { historyOf } from './state';
import { normaliseRoute, sameRoute } from './route';
import { isObject } from './json';
import type { Plugins } from './plugins';
import { LIMITS, type Availability, type Face, type History, type Json, type Preferences, type Route, type RouteInput, type TabId } from './types';

// What every operation needs besides the state, and how a destination becomes a route, a face and a key.

export type Context = {
  readonly plugins: Plugins;
  readonly newId: () => TabId;
  readonly preferences: () => Preferences;
};

export type Resolved = { readonly route: Route; readonly face: Face; readonly key: string };

export type Resolution =
  | { readonly ok: true; readonly resolved: Resolved; readonly availability: Availability }
  | { readonly ok: false; readonly reason: 'invalid' | 'unavailable'; readonly message: string };

/**
 * The route a destination opens, as its plugin completes it from the route the user is on, and what the plugin says about it. Refused when the route is not valid data, when
 * the plugin refuses to complete it, and when the plugin cannot serve it (ch16 S65: a degraded one opens, to a recovery page).
 */
export function resolveDestination(ctx: Context, input: RouteInput, source: string, from: Route | undefined): Resolution {
  const asked = normaliseRoute(input);
  if (!asked) {
    return { ok: false, reason: 'invalid', message: 'The destination is not a plugin, a page and plain parameters.' };
  }

  const route = ctx.plugins.complete(asked, from, source);
  if (!route) {
    return { ok: false, reason: 'unavailable', message: `${asked.plugin} did not open ${asked.contribution}.` };
  }

  const availability = ctx.plugins.availability(route);
  if (availability.state === 'unavailable') {
    return { ok: false, reason: 'unavailable', message: availability.reason };
  }

  const { face, key } = ctx.plugins.look(route);
  return { ok: true, resolved: { route, face, key }, availability };
}

/** Where a history and the page state on screen are after a move: the history, and what the page of the entry the tab is now on has kept (`null`: nothing, a clean page). */
export type Moved = { readonly history: History; readonly pageState: Json };

/** The member of a page state that says where the page is scrolled (ch16 S141): the one thing in it the model reads. */
export const PAGE_SCROLL = 'scroll';

/**
 * What a new navigation to a place the tab has been at takes of the page state that place kept: all of it but where it was scrolled. A page that is navigated to opens at its top; Back and Forward are
 * what give a place back as it was left, offset included.
 */
export function seeded(state: Json): Json {
  if (state === null || typeof state !== 'object' || Array.isArray(state) || !Object.hasOwn(state, PAGE_SCROLL)) {
    return state;
  }

  const rest = Object.fromEntries(Object.entries(state).filter(([member]) => member !== PAGE_SCROLL));
  return Object.keys(rest).length === 0 ? null : Object.freeze(rest);
}

/** What each entry's page kept when it was left, one for each entry: `null` where nothing was (`History.states`, which is absent while nothing was kept). */
const statesOf = (history: History): Json[] => history.entries.map((_entry, i) => history.states?.[i] ?? null);

/**
 * A tab's place at one more step (ch16 S60): the entry after the current one, the entries ahead of it dropped with what their pages kept, at most 50 kept, the oldest and what its page kept going first.
 * The entry the tab leaves keeps `left`, the state of the page it leaves (H7). The page it goes to starts clean, but for a place the tab has been at: when an earlier entry of the history that is kept
 * holds this very route, the page starts with what the NEWEST such entry kept, except where it was scrolled (the mock keeps a list's state per tab while the list is the same, the mock's list module, docs/ui-next/status/H7.md).
 * An entry the cap drops with this very step is not held, and does not give its state.
 */
export function pushed(history: History, route: Route, left: Json): Moved {
  const upto = history.index + 1;
  const from = Math.max(0, upto - (LIMITS.history - 1));
  const entries = history.entries.slice(from, upto);
  const states = statesOf(history).slice(from, upto);
  states[states.length - 1] = left;
  let pageState: Json = null;
  for (let i = entries.length - 2; i >= 0; i -= 1) {
    const earlier = entries[i];
    if (earlier !== undefined && sameRoute(earlier, route)) {
      pageState = seeded(states[i] ?? null);
      break;
    }
  }

  return { history: historyOf([...entries, route], entries.length, [...states, null]), pageState };
}

/** A step to the entry at `to` (ch16 S50): the entry the tab leaves keeps `left`, and the page of the entry it goes to is given what that entry kept, which it no longer holds: the page on screen keeps its own. */
export function stepped(history: History, to: number, left: Json): Moved {
  const states = statesOf(history);
  const pageState = states[to] ?? null;
  states[history.index] = left;
  states[to] = null;
  return { history: historyOf(history.entries, to, states), pageState };
}

/** The current entry is another route (a change inside the page, or of its scope): what the other entries' pages kept stays with them. */
export const replaced = (history: History, route: Route): History => historyOf(history.entries.map((entry, i) => (i === history.index ? route : entry)), history.index, history.states);

/** The history a saved tab keeps: at most 10 entries, around the current one (ch16 S32). */
export function windowHistory(history: History): History {
  const start = Math.min(Math.max(history.index - 5, 0), Math.max(0, history.entries.length - LIMITS.persistedHistory));
  return historyOf(history.entries.slice(start, start + LIMITS.persistedHistory), history.index - start);
}

/**
 * A history read back from data that may be damaged: the entries that are routes (each as `mapEntry` has it, which may drop it), in order, around the entry that is the tab's own.
 * When that entry did not survive, or is not the tab's route, the history starts over at the route.
 */
export function repairHistory(raw: unknown, current: Route, mapEntry: (route: Route) => Route | false): History {
  const input: unknown[] = isObject(raw) && Array.isArray(raw.entries) ? raw.entries.slice(0, LIMITS.history) : [];
  const at: unknown = isObject(raw) ? raw.index : undefined;
  const active = typeof at === 'number' && Number.isInteger(at) ? at : input.length - 1;
  const entries: Route[] = [];
  let index = -1;
  input.forEach((entry, i) => {
    const route = normaliseRoute(entry);
    const mapped = route ? mapEntry(route) : false;
    if (mapped) {
      if (i === active) {
        index = entries.length;
      }

      entries.push(mapped);
    }
  });

  const found = entries[index];
  if (found === undefined || !sameRoute(found, current)) {
    return historyOf([current], 0);
  }

  entries[index] = current;
  return historyOf(entries, index);
}
