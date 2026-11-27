import { isPlainObject } from '../tabs/json';
import { migrate, type MigrateResult, type Migration } from '../tabs/persist';
import { normaliseRoute } from '../tabs/route';
import { limitsOf, MIN_HEIGHT } from './height';
import { emptyPanel, identifier, own, patch, settle } from './state';
import { RATIO_EPSILON, equalRatios } from './ratios';
import { LAYOUT_VERSION, LIMITS, PANEL_VERSION, type PaneAxis, type PaneGroup, type PanelState, type PersistedLayout, type PersistedPanel, type PersistedPanes, type PersistedSession, type Route, type Session, type SessionId, type ToolId } from './types';

// The saved panel (ch16 S103, S116, S150). The document carries its version, `migrate` brings an older one up to the current, and what is read back is repaired rather than discarded: a
// damaged session is dropped alone and the rest is kept. It saves what the user chose (open, height, the tool, the session of each tool) and each session's identity; never what a session
// was doing, which is nobody's any more (a restored session is `ended`) and never its output. The old app has 36 stores that were never versioned; this is not the 37th.
// What the user chose comes back as they left it, the panel's visibility included (T2d, decision A23): S116's "do not open it" is about a restored session, and a panel the user left open is not one.

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
      sessions.push({ id, tool: session.tool, plugin: session.plugin, title: session.title, scope: session.scope, ...(session.titlePinned === true ? { titlePinned: true as const } : {}), ...(session.route === undefined ? {} : { route: session.route }) });
    }
  }

  const saved = new Set(sessions.map((session) => session.id));
  const active = Object.fromEntries(Object.entries(state.active).filter(([, id]) => saved.has(id)));

  const layout = layoutOf(state, saved);
  return { version: PANEL_VERSION, open: state.open, height: state.height, tool: state.tool, active, sessions, ...(layout === undefined ? {} : { layout }) };
}

/**
 * What the saved panel keeps of the panes: for each tool with a group, the sessions of its panes that the saved panel keeps (the newest 50 sessions), their shares and the index of the active pane. A group that
 * keeps fewer than two panes is not saved, and a panel with no group saves no layout at all: it is the document it was before panes.
 */
function layoutOf(state: PanelState, saved: ReadonlySet<SessionId>): PersistedLayout | undefined {
  const tools: Array<readonly [ToolId, PersistedPanes]> = [];
  for (const [tool, group] of Object.entries(state.panes)) {
    const kept = group.panes.flatMap((pane, index) => (saved.has(pane.session) ? [{ pane, ratio: group.ratios[index] }] : []));
    if (kept.length < 2) {
      continue;
    }

    const total = kept.reduce((sum, one) => sum + one.ratio, 0);
    const whole = kept.length === group.panes.length;
    const active = kept.findIndex((one) => one.pane.id === group.active);
    tools.push([tool, { axis: group.axis, sessions: kept.map((one) => one.pane.session), ratios: kept.map((one) => (whole ? one.ratio : one.ratio / total)), active: active === -1 ? kept.length - 1 : active }]);
  }

  return tools.length === 0 ? undefined : { version: LAYOUT_VERSION, tools: Object.fromEntries(tools) };
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
 * Reads a saved panel back into a state. A session that cannot be read is dropped alone; every session comes back `ended`. The panel comes back as it was left: open when it was open, with its height, its tool and the session of each
 * tool, whatever sessions it holds (T2d, decision A23). S116 says "Sessions restored at startup, adopted from another window, or re-created by Retry do not open it (today's quiet-tab rule)", and "Why: a restored terminal must not
 * cover the page": a restored SESSION opens no panel, and nothing here or in the registry does (`reveal: false` stays); the person's own saved panel is not a session. A terminal that is alive again after a reload must not wait
 * unseen behind a closed panel, and VS Code and JetBrains both keep the panel's visibility and the active terminal across a reload. The tools are the host's to register again, and no plugin is live until it says so, so the tool and the
 * session a panel was saved on are on screen when their plugin has loaded, and until then it shows the first tool it has.
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

  const groups = readLayout(saved.layout, sessions, active, problems);
  for (const [tool, group] of groups) {
    active.set(tool, group.panes.find((pane) => pane.id === group.active)?.session ?? group.panes[0].session);
  }

  const height = typeof saved.height === 'number' && Number.isFinite(saved.height) && saved.height > 0 ? remembered(saved.height, options.viewport) : null;
  if (saved.height !== null && saved.height !== undefined && height === null) {
    problems.push('the height is not a size');
  }

  const tool = typeof saved.tool === 'string' && saved.tool !== '' ? saved.tool : null;
  const state = settle(
    patch(emptyPanel(), {
      open: saved.open === true,
      height,
      tool,
      active: Object.freeze(Object.fromEntries(active)),
      sessions: Object.freeze(Object.fromEntries(sessions)),
      order: Object.freeze(order),
      panes: Object.freeze(Object.fromEntries(groups)),
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

  return Object.freeze({ id, tool, plugin, title, scope: text(entry.scope), state: 'ended' as const, since: now, cause: RESTORED_CAUSE, ...(entry.titlePinned === true ? { titlePinned: true as const } : {}), ...(route === undefined ? {} : { route }) });
}

/**
 * The panes of a saved layout. A layout is optional (every panel saved before panes has none, and reads as one session per tool) and has a version of its own; one this build cannot read costs the layout and nothing
 * else. Each tool's group is repaired rather than discarded: a pane whose session is not saved, is not a session of the tool or is in a pane already is dropped, shares that are not shares are made equal, and a group
 * left with fewer than two panes is not a group. The pane that was active is the tool's saved session when that is one of the panes, else the one the layout names, else the last.
 */
function readLayout(raw: unknown, sessions: ReadonlyMap<SessionId, Session>, active: ReadonlyMap<ToolId, SessionId>, problems: string[]): Map<ToolId, PaneGroup> {
  const groups = new Map<ToolId, PaneGroup>();
  if (raw === undefined) {
    return groups;
  }

  if (!isPlainObject(raw) || raw.version !== LAYOUT_VERSION) {
    problems.push('the layout is not a layout of a version this build reads');
    return groups;
  }

  if (!isPlainObject(raw.tools)) {
    problems.push('the layout has no tools');
    return groups;
  }

  const used = new Set<SessionId>();
  for (const [tool, entry] of Object.entries(raw.tools)) {
    const group = readGroup(tool, entry, sessions, active.get(tool), used, (why) => problems.push(`the layout of ${tool} ${why}`));
    if (group !== undefined) {
      groups.set(tool, group);
    }
  }

  return groups;
}

function readGroup(tool: ToolId, entry: unknown, sessions: ReadonlyMap<SessionId, Session>, chosen: SessionId | undefined, used: Set<SessionId>, note: (why: string) => void): PaneGroup | undefined {
  if (!isPlainObject(entry)) {
    note('is not an object');
    return undefined;
  }

  const listed: readonly unknown[] = Array.isArray(entry.sessions) ? entry.sessions : [];
  const axis: PaneAxis = entry.axis === 'column' ? 'column' : 'row';
  if (entry.axis !== 'row' && entry.axis !== 'column') {
    note('has an axis it does not know: it is read as row');
  }

  const shares: readonly unknown[] | undefined = Array.isArray(entry.ratios) ? entry.ratios : undefined;
  const sound = shares?.length === listed.length && shares.every((one) => typeof one === 'number' && Number.isFinite(one) && one > 0) && Math.abs(shares.reduce<number>((sum, one) => sum + (one as number), 0) - 1) <= 1e-6;
  const kept: Array<{ readonly session: SessionId; readonly ratio: number }> = [];
  listed.forEach((id, index) => {
    if (typeof id === 'string' && sessions.get(id)?.tool === tool && !used.has(id) && !kept.some((one) => one.session === id)) {
      kept.push({ session: id, ratio: sound ? (shares?.[index] as number) : 0 });
    }
  });

  if (kept.length !== listed.length) {
    note('had panes whose session is not saved, is not the tool\'s or is in another pane: they are dropped');
  }

  if (kept.length < 2) {
    note('has fewer than two panes: it is not a group');
    return undefined;
  }

  let ratios: number[];
  if (!sound) {
    note('has shares that are not one share above zero for each pane, summing to 1: the panes share equally');
    ratios = [...equalRatios(kept.length)];
  } else {
    const total = kept.reduce((sum, one) => sum + one.ratio, 0);
    ratios = kept.map((one) => (kept.length !== listed.length || Math.abs(total - 1) > RATIO_EPSILON / 1000 ? one.ratio / total : one.ratio));
  }

  const named = typeof entry.active === 'number' && Number.isInteger(entry.active) ? listed[entry.active] : undefined;
  if (named === undefined) {
    note('names an active pane that is not one of its panes: the last is active');
  }

  const activeSession = kept.find((one) => one.session === chosen)?.session ?? kept.find((one) => one.session === named)?.session ?? kept[kept.length - 1].session;
  for (const one of kept) {
    used.add(one.session);
  }

  const panes = kept.map((one, index) => Object.freeze({ id: `p${String(index + 1)}`, session: one.session }));
  return Object.freeze({ axis, panes: Object.freeze(panes), ratios: Object.freeze(ratios), active: panes.find((pane) => pane.session === activeSession)?.id ?? panes[panes.length - 1].id, seq: panes.length });
}
