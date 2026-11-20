import { isObject } from '../tabs/json';
import { migrate, type Migration } from '../tabs/persist';
import { normaliseRoute, paramsText } from '../tabs/route';
import type { CrumbInput, Description, Route } from '../tabs/types';
import { NOUNS } from './results';
import { isTone, LIMITS, PALETTE_VERSION, type PersistedPalette, type PersistedRecent, type RecordInput, type Recent } from './types';

// The recent destinations (ch16 S73): the last eight opened anywhere in the app, newest first, one for each place; they are also the recent-tab switcher. A recent is what draws before
// its plugin has loaded (its title, glyph and where it is) and what opens it again (its route); a plugin that is loaded describes it again. The saved form carries its version, and
// `migrate` (the tab model's) brings an older one up; what is read back is repaired rather than discarded: a damaged entry is dropped alone. The old app has 36 stores that were never
// versioned; this is not the 37th.

/** The steps from every older version, keyed by the version they start from. Empty at version 1: the first release has nothing to migrate from. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

const KINDS: ReadonlyArray<Recent['kind']> = ['page', 'home', 'scope', 'type', 'resource', 'setting'];

/** What a place is, by its route: the same whatever order its parameters were written in. */
export const routeKey = (route: Route): string => `${route.plugin}|${route.contribution}|${paramsText(route.params)}`;

/**
 * A list of places as one text: a place another part already named is said once ("Stack · prod-eu › Services", never "prod-eu" twice). A part is a list of places joined by ` › `; the
 * parts are joined by ` · `.
 */
function places(...parts: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const chunks = part
      .split(' · ')
      .map((chunk) =>
        chunk
          .split(' › ')
          .filter((piece) => {
            const name = piece.toLowerCase();
            if (piece === '' || seen.has(name)) {
              return false;
            }

            seen.add(name);
            return true;
          })
          .join(' › '),
      )
      .filter((chunk) => chunk !== '');
    if (chunks.length > 0) {
      out.push(chunks.join(' · '));
    }
  }

  return out.join(' · ');
}

const labelOfCrumb = (crumb: CrumbInput): string => (typeof crumb === 'string' ? crumb : crumb.label);

/** Where a described place is: its plugin, the path above it (without the plugin's own name again) and its scope. A host page says no plugin name and no path, and so has no context. */
export function contextOf(description: Description): string {
  const own = (description.pluginName ?? '').trim();
  const above = (description.path ?? []).slice(0, -1).map(labelOfCrumb);
  if (above[0]?.toLowerCase() === own.toLowerCase()) {
    above.shift();
  }

  return places(own, above.join(' › '), description.scope?.label ?? '');
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function make(route: Route, kind: Recent['kind'], noun: string, title: string, context: string, icon: string, tone: Recent['tone']): Recent {
  return Object.freeze({ key: routeKey(route), route, kind, noun: noun === '' ? NOUNS[kind] : noun, title, context, icon, tone });
}

/** The recent for a place, from what the caller knows and what its plugin says; `undefined` for a route that is not valid data or a place that has no name. */
export function recentOf(input: RecordInput, describe?: (route: Route) => Description | undefined): Recent | undefined {
  const route = normaliseRoute(input.route);
  if (route === undefined) {
    return undefined;
  }

  const said = text(input.title) === '' || input.context === undefined || input.icon === undefined ? describe?.(route) : undefined;
  const title = text(input.title) || text(said?.title);
  if (title === '') {
    return undefined;
  }

  return make(route, input.kind !== undefined && KINDS.includes(input.kind) ? input.kind : 'page', text(input.noun), title, input.context ?? (said === undefined ? '' : contextOf(said)), input.icon ?? text(said?.icon), isTone(input.tone) ? input.tone : 'neutral');
}

const same = (a: Recent, b: Recent): boolean => a.kind === b.kind && a.noun === b.noun && a.title === b.title && a.context === b.context && a.icon === b.icon && a.tone === b.tone;

/**
 * The list with a place first, once, and at most `LIMITS.recents` long. The same list when the place is already first and says the same, so that remembering a place the user is
 * already on changes nothing and saves nothing.
 */
export function record(list: readonly Recent[], recent: Recent): readonly Recent[] {
  const first = list[0];
  if (first?.key === recent.key && same(first, recent)) {
    return list;
  }

  return Object.freeze([recent, ...list.filter((item) => item.key !== recent.key)].slice(0, LIMITS.recents));
}

/** What the session saves of the recents. */
export function serialiseRecents(list: readonly Recent[]): PersistedPalette {
  return { version: PALETTE_VERSION, recents: list.slice(0, LIMITS.recents).map(({ key: _key, ...rest }): PersistedRecent => rest) };
}

export type RestoreRecentsOptions = {
  /** The version this build reads. Default: `PALETTE_VERSION`. A seam for the test of a migration. */
  readonly current?: number | undefined;
  readonly steps?: Readonly<Record<number, Migration>> | undefined;
};

export type RestoreRecentsResult =
  | { readonly ok: true; readonly recents: readonly Recent[]; /** Something was dropped or fixed. */ readonly repaired: boolean; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: 'missing' | 'unreadable' | 'foreign-version'; readonly detail: string };

/** One saved entry, read; `undefined` when it cannot be (said to `note`). A field that is wrong is made right: it is the route and the name that make an entry. */
function readRecent(entry: unknown, note: (why: string) => void): Recent | undefined {
  if (!isObject(entry)) {
    note('is not an object');
    return undefined;
  }

  const route = normaliseRoute(entry.route);
  const title = text(entry.title);
  if (route === undefined || title === '') {
    note('has no valid route or no name');
    return undefined;
  }

  const kind = typeof entry.kind === 'string' ? KINDS.find((candidate) => candidate === entry.kind) : undefined;
  if (kind === undefined || !isTone(entry.tone)) {
    note('had a kind or a tone that is not known');
  }

  return make(route, kind ?? 'page', text(entry.noun), title, text(entry.context), text(entry.icon), isTone(entry.tone) ? entry.tone : 'neutral');
}

/**
 * Reads a saved document back. Nothing saved is `missing`; text that is not a versioned document is `unreadable`; a version newer than this build, or older with no way up, is
 * `foreign-version`: it is never half used. A list that cannot be read at all is an empty one, said in `problems`.
 */
export function restoreRecents(raw: unknown, options: RestoreRecentsOptions = {}): RestoreRecentsResult {
  const migrated = migrate(raw, { current: options.current ?? PALETTE_VERSION, steps: options.steps ?? MIGRATIONS });
  if (!migrated.ok) {
    return migrated;
  }

  const problems: string[] = [];
  const entries: unknown = migrated.value.recents;
  if (!Array.isArray(entries)) {
    problems.push('the list of recents is not a list');
    return { ok: true, recents: Object.freeze([]), repaired: true, problems };
  }

  const seen = new Set<string>();
  const kept: Recent[] = [];
  entries.forEach((entry: unknown, index) => {
    const recent = readRecent(entry, (why) => problems.push(`recent ${String(index)} ${why}`));
    if (recent === undefined) {
      return;
    }

    if (seen.has(recent.key)) {
      problems.push(`recent ${String(index)} is a place that is already in the list`);
    } else {
      seen.add(recent.key);
      kept.push(recent);
    }
  });

  if (kept.length > LIMITS.recents) {
    problems.push(`there were more than ${String(LIMITS.recents)} recents`);
  }

  return { ok: true, recents: Object.freeze(kept.slice(0, LIMITS.recents)), repaired: problems.length > 0, problems };
}
