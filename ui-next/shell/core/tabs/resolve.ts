import { historyOf } from './state';
import { normaliseRoute, sameRoute } from './route';
import { isObject } from './json';
import type { Plugins } from './plugins';
import { LIMITS, type Availability, type Face, type History, type Preferences, type Route, type RouteInput, type TabId } from './types';

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

/** A tab's place at one more step: the entry after the current one, the entries ahead of it dropped, at most 50 kept (ch16 S60). */
export function pushed(history: History, route: Route): History {
  const kept = history.entries.slice(0, history.index + 1);
  kept.push(route);
  const entries = kept.length > LIMITS.history ? kept.slice(kept.length - LIMITS.history) : kept;
  return historyOf(entries, entries.length - 1);
}

export const replaced = (history: History, route: Route): History => historyOf(history.entries.map((entry, i) => (i === history.index ? route : entry)), history.index);

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
