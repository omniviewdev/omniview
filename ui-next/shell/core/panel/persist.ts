import { isPlainObject } from '../tabs/json';
import { migrate, type MigrateResult, type Migration } from '../tabs/persist';
import { normaliseRoute } from '../tabs/route';
import { limitsOf, MIN_HEIGHT } from './height';
import { emptyPanel, identifier, own, patch, settle } from './state';
import { LIMITS, PANEL_VERSION, type PanelState, type PersistedPanel, type PersistedSession, type Route, type Session, type SessionId, type ToolId } from './types';

// The saved panel (ch16 S103, S116, S150). The document carries its version, `migrate` brings an older one up to the current, and what is read back is repaired rather than discarded: a
// damaged session is dropped alone and the rest is kept. It saves what the user chose (open, height, the tool, the session of each tool) and each session's identity; never what a session
// was doing, which is nobody's any more (a restored session is `ended`) and never its output. The old app has 36 stores that were never versioned; this is not the 37th.

export type { Migration, MigrateResult };

/** The steps from every older version, keyed by the version they start from. Empty at version 1: the first release has nothing to migrate from. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

/** What a session that was restored says: it was running in the last life of the app, and nothing is running now (the mock: "Session ended when Omniview restarted"). */
export const RESTORED_CAUSE = 'The session ended when the app restarted.';

/** What the session saves of the panel: the choices, and the newest sessions, oldest first. */
export function serialise(state: PanelState): PersistedPanel {
  const sessions: PersistedSession[] = [];
  for (const id of state.order.slice(-LIMITS.persistedSessions)) {
    const session = own(state.sessions, id);
    if (session !== undefined) {
      sessions.push({ id, tool: session.tool, plugin: session.plugin, title: session.title, scope: session.scope, ...(session.route === undefined ? {} : { route: session.route }) });
    }
  }

  const saved = new Set(sessions.map((session) => session.id));
  const active = Object.fromEntries(Object.entries(state.active).filter(([, id]) => saved.has(id)));

  return { version: PANEL_VERSION, open: state.open, height: state.height, tool: state.tool, active, sessions };
}

export type RestoreOptions = {
  /** The time a restored session says it ended at. */
  readonly now: number;
  /**
   * The height of the window the panel is read in. A remembered size is then brought within that window's limits, as the mock clamps what it loads (S103). Absent, only the minimum is kept,
   * and whoever draws the panel fits the size to its window (`fitHeight`).
   */
  readonly viewport?: number | undefined;
};

export type RestoreResult =
  | { readonly ok: true; readonly state: PanelState; /** Something was dropped or fixed. */ readonly repaired: boolean; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: 'missing' | 'unreadable' | 'foreign-version'; readonly detail: string };

/** The words a person reads, cut to the limit. Identifiers are not words (`identifier`). */
const text = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, LIMITS.text) : '');

/** A saved size as the model keeps it: at least the minimum and, in a window that is known, at most what that window allows. */
function remembered(size: number, viewport: number | undefined): number {
  const { min, max } = viewport !== undefined && viewport > 0 ? limitsOf(viewport) : { min: MIN_HEIGHT, max: Number.POSITIVE_INFINITY };
  return Math.min(max, Math.max(min, Math.round(size)));
}

/**
 * Reads a saved panel back into a state. A session that cannot be read is dropped alone; every session comes back `ended`; the panel does not open because sessions were restored (S116: a
 * restored terminal must not cover the page), though it opens as it was left when there are none. The tools are the host's to register again, and no plugin is live until it says so, so
 * a restored session of a plugin shows when its plugin has loaded.
 */
export function restorePanel(raw: unknown, options: RestoreOptions): RestoreResult {
  const migrated = migrate(raw, { current: PANEL_VERSION, steps: MIGRATIONS });
  if (!migrated.ok) {
    return migrated;
  }

  const saved = migrated.value;
  const problems: string[] = [];
  // Maps while the sessions are read, and an object once, from entries: an id the prototype also names (`constructor`, `__proto__`) is a session like any other, and `sessions[id] = ...`
  // with `__proto__` would set the prototype, not an entry.
  const sessions = new Map<SessionId, Session>();
  const entries: unknown = saved.sessions;
  if (entries !== undefined && !Array.isArray(entries)) {
    problems.push('the list of sessions is not a list');
  }

  (Array.isArray(entries) ? entries : []).slice(-LIMITS.persistedSessions).forEach((entry: unknown, index) => {
    const session = readSession(entry, options.now, sessions, (why) => problems.push(`session ${String(index)} ${why}`));
    if (session !== undefined) {
      sessions.set(session.id, session);
    }
  });

  const order = [...sessions.keys()];
  const active = new Map<ToolId, SessionId>();
  if (isPlainObject(saved.active)) {
    for (const [tool, id] of Object.entries(saved.active)) {
      if (typeof id === 'string' && sessions.get(id)?.tool === tool) {
        active.set(tool, id);
      }
    }
  }

  const wasOpen = saved.open === true;
  const height = typeof saved.height === 'number' && Number.isFinite(saved.height) && saved.height > 0 ? remembered(saved.height, options.viewport) : null;
  if (saved.height !== null && saved.height !== undefined && height === null) {
    problems.push('the height is not a size');
  }

  const tool = typeof saved.tool === 'string' && saved.tool !== '' ? saved.tool : null;
  const state = settle(
    patch(emptyPanel(), {
      open: wasOpen && order.length === 0,
      height,
      tool,
      active: Object.freeze(Object.fromEntries(active)),
      sessions: Object.freeze(Object.fromEntries(sessions)),
      order: Object.freeze(order),
    }),
  );
  return { ok: true, state, repaired: problems.length > 0, problems };
}

function readSession(entry: unknown, now: number, taken: ReadonlyMap<SessionId, Session>, note: (why: string) => void): Session | undefined {
  if (!isPlainObject(entry)) {
    note('is not an object');
    return undefined;
  }

  const { id } = entry;
  const tool = identifier(entry.tool);
  const plugin = identifier(entry.plugin);
  const title = text(entry.title);
  if (typeof id !== 'string' || id === '' || tool === '' || plugin === '' || title === '') {
    note('has no id, tool, plugin or title');
    return undefined;
  }

  if (taken.has(id)) {
    note('has the id of another session');
    return undefined;
  }

  let route: Route | undefined;
  if (entry.route !== undefined) {
    route = normaliseRoute(entry.route);
    if (route === undefined) {
      note('had a route that is not valid');
    }
  }

  return Object.freeze({ id, tool, plugin, title, scope: text(entry.scope), state: 'ended' as const, since: now, cause: RESTORED_CAUSE, ...(route === undefined ? {} : { route }) });
}
