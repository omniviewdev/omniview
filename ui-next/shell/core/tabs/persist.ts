import { isPlainObject } from './json';
import { savedFace, keyOf } from './face';
import { normaliseKeepAlive } from './keepAlive';
import { guardContributions, logError, type ErrorHook, type Plugins } from './plugins';
import { repairHistory, windowHistory } from './resolve';
import { normaliseTabRoute, sameRoute } from './route';
import { changeTab, flagsOf, makeTab } from './state';
import { LIMITS, STATE_VERSION, type Contributions, type KeepAlive, type PersistedTab, type PersistedTabs, type Tab, type TabId, type TabsState } from './types';

// The saved session (ch16 S32, S150). The document carries its version, `migrate` brings an older one up to the current, and what is read back is repaired rather than
// discarded: a damaged tab is dropped alone and the rest of the session is kept. The old app has 36 stores that were never versioned; this is not the 37th.

/** One step of a migration: a document of version N to a document of version N + 1. Pure, and it must say its new version. */
export type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

/** Version 2 adds tagged locations. The version 1 ordinary page representation is unchanged. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  1: (value: Record<string, unknown>) => ({ ...value, version: 2 }),
});

export type MigrateOptions = {
  readonly current?: number | undefined;
  readonly steps?: Readonly<Record<number, Migration>> | undefined;
};

export type MigrateResult =
  | { readonly ok: true; readonly version: number; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly reason: 'missing' | 'unreadable' | 'foreign-version'; readonly detail: string };

/**
 * A saved document at the current version, or why it cannot be. Nothing saved is `missing`; text that is not a versioned document is `unreadable`; a version newer than this
 * build, or older with no way up, is `foreign-version`: it is never half used.
 */
export function migrate(raw: unknown, options: MigrateOptions = {}): MigrateResult {
  const current = options.current ?? STATE_VERSION;
  const steps = options.steps ?? MIGRATIONS;
  if (raw === undefined || raw === null) {
    return { ok: false, reason: 'missing', detail: 'nothing was saved' };
  }

  if (!isPlainObject(raw) || typeof raw.version !== 'number' || !Number.isInteger(raw.version)) {
    return { ok: false, reason: 'unreadable', detail: 'the saved value is not a document with a whole-number version' };
  }

  let value: Record<string, unknown> = raw;
  let version = raw.version;
  if (version > current) {
    return { ok: false, reason: 'foreign-version', detail: `saved by a newer version (${version}); this one reads up to ${current}` };
  }

  while (version < current) {
    const step: Migration | undefined = steps[version];
    if (!step) {
      return { ok: false, reason: 'foreign-version', detail: `no migration from version ${version}` };
    }

    try {
      value = step(value);
    } catch (error) {
      return { ok: false, reason: 'unreadable', detail: `the migration from version ${version} failed: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (!isPlainObject(value) || value.version !== version + 1) {
      return { ok: false, reason: 'unreadable', detail: `the migration from version ${version} did not produce version ${version + 1}` };
    }

    version += 1;
  }

  return { ok: true, version, value };
}

/** What the session saves: the tabs in strip order and the one on screen, each with its route, flags and a window of its history. No page state, and nothing that means "now". */
export function serialise(state: TabsState): PersistedTabs {
  const tabs: PersistedTab[] = [];
  for (const id of state.order) {
    const tab = state.tabs[id];
    if (tab) {
      const route = tab.location.route;
      const presentation = route.kind === 'extension-view' ? {} : { key: tab.location.key, face: tab.face };
      tabs.push({ id, route, ...presentation, pinned: tab.flags.pinned, preview: tab.flags.preview, history: windowHistory(tab.history) });
    }
  }

  return { version: STATE_VERSION, active: state.active, tabs };
}

export type RestoreOptions = {
  readonly contributions: Contributions;
  readonly keepAlive?: Partial<KeepAlive> | undefined;
  readonly onError?: ErrorHook | undefined;
};

export type RestoreResult =
  | { readonly ok: true; readonly state: TabsState; /** Something was dropped or fixed. */ readonly repaired: boolean; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: 'missing' | 'unreadable' | 'foreign-version' | 'empty'; readonly detail: string };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Reads a saved session back into a state. A tab that cannot be read is dropped alone; the pinned zone is put first, one preview is kept, one tab per singleton page is kept, and
 * the tab on screen is found again. A tab's face is described again by its plugin; when the plugin says nothing yet (it has not loaded) the face it was saved with is kept, so
 * the strip draws the tab as the user left it. Only the tab on screen is mounted: a restored tab has no page until it is shown (ch16 S32).
 */
export function restoreTabs(raw: unknown, options: RestoreOptions): RestoreResult {
  const migrated = migrate(raw);
  if (!migrated.ok) {
    return migrated;
  }

  const { tabs } = migrated.value;
  if (!Array.isArray(tabs)) {
    return { ok: false, reason: 'unreadable', detail: 'the saved document has no list of tabs' };
  }

  const plugins = guardContributions(options.contributions, options.onError ?? logError);
  const problems: string[] = [];
  const read: Tab[] = [];
  const seen = new Set<TabId>();
  tabs.forEach((entry: unknown, index) => {
    const tab = readTab(entry, plugins, (why) => problems.push(`tab ${index} ${why}`));
    if (tab && seen.has(tab.id)) {
      problems.push(`tab ${index} has the id of another tab`);
    } else if (tab) {
      seen.add(tab.id);
      read.push(tab);
    }
  });

  const kept = settle(read, problems);
  if (kept.length === 0) {
    return { ok: false, reason: 'empty', detail: 'no saved tab could be read' };
  }

  const wanted = migrated.value.active;
  const selected = kept.find((tab) => tab.id === wanted);
  // Version 2 can save a background-only window. When a selected tab is corrupt, never promote a background mount to issue demand on restore.
  const noSelection = wanted === null && isPlainObject(raw) && raw.version === STATE_VERSION;
  const active = selected?.id ?? (noSelection ? null : (kept.find((tab) => tab.location.route.kind === undefined)?.id ?? null));
  if (typeof wanted === 'string' && active !== wanted) {
    problems.push('the tab on screen is not one of the tabs');
  }

  const byId: Record<TabId, Tab> = {};
  for (const tab of kept) {
    byId[tab.id] = tab;
  }

  const state: TabsState = Object.freeze({
    version: STATE_VERSION,
    tabs: Object.freeze(byId),
    order: Object.freeze(kept.map((tab) => tab.id)),
    active,
    activeVisit: 0,
    mounted: Object.freeze(active === null ? [] : [active]),
    closed: Object.freeze([]),
    keepAlive: normaliseKeepAlive(options.keepAlive),
    serial: 0,
    started: true,
  });
  return { ok: true, state, repaired: problems.length > 0, problems };
}

/** The pinned zone first, one preview, one tab per singleton page: the rules a sound strip keeps, applied to what was read. */
function settle(read: readonly Tab[], problems: string[]): Tab[] {
  const ordered = [...read.filter((tab) => tab.flags.pinned), ...read.filter((tab) => !tab.flags.pinned)];
  if (ordered.some((tab, i) => tab !== read[i])) {
    problems.push('the pinned tabs were not first');
  }

  const singletons = new Set<string>();
  let preview = false;
  const kept: Tab[] = [];
  for (const tab of ordered) {
    if (tab.face.singleton) {
      if (singletons.has(tab.location.key)) {
        problems.push(`${tab.location.key} was open twice`);
        continue;
      }

      singletons.add(tab.location.key);
    }

    if (tab.flags.preview && preview) {
      problems.push('there was more than one preview tab');
      kept.push(changeTab(tab, { flags: flagsOf({ ...tab.flags, preview: false }) }));
      continue;
    }

    preview ||= tab.flags.preview;
    kept.push(tab);
  }

  return kept;
}

export function readTab(entry: unknown, plugins: Plugins, note: (why: string) => void): Tab | undefined {
  if (!isPlainObject(entry)) {
    note('is not an object');
    return undefined;
  }

  const id = text(entry.id);
  const saved = normaliseTabRoute(entry.route);
  if (id === '' || !saved) {
    note('has no id or no valid route');
    return undefined;
  }

  const route = plugins.restore(saved);
  if (route === false) {
    note('was dropped by its plugin');
    return undefined;
  }

  const same = sameRoute(route, saved);
  // The face the tab was saved with, as the host lets it stand (and what the host learns from it) before the plugin is asked: the plugin's description then has what the window learned.
  const kept = same && route.kind === undefined ? plugins.restoreFace(savedFace(entry.face, route), route) : undefined;
  const looked = plugins.look(route);
  const face = looked.described || kept === undefined ? looked.face : kept;
  const key = looked.described || kept === undefined ? looked.key : text(entry.key) || keyOf(route, undefined, face);
  const history = repairHistory(entry.history, route, (other) => plugins.restore(other), LIMITS.persistedHistory);
  if (isPlainObject(entry.history) && !sameHistory(entry.history, history)) {
    note('had a history that was repaired');
  }

  return makeTab({ id, route, key, face, history, flags: { pinned: entry.pinned === true, preview: entry.preview === true } });
}

/** True when the repaired history is the saved one: every entry kept, at the same place. */
const sameHistory = (saved: Record<string, unknown>, repaired: { readonly entries: readonly unknown[]; readonly index: number }): boolean =>
  Array.isArray(saved.entries) && saved.entries.length === repaired.entries.length && saved.index === repaired.index;
