import { RATIO_EPSILON } from './ratios';
import { HOST, PANEL_VERSION, type Noop, type PaneGroup, type PanelState, type Refused, type RefusedReason, type Session, type SessionId, type Shown, type Tool, type ToolId } from './types';

// The state's shape and the helpers every operation uses. An operation is a function from a state to a new state and a result: it returns the same state object when it changed
// nothing, so the store has nobody to notify (docs/ui-next/optimisations.md HLT-39, HSH-24), and everything it makes is frozen.

/** What an operation answers: the state after it, and what happened. */
export type Step<R> = { readonly state: PanelState; readonly result: R };

/** What an operation needs of the world: an id for a new session and the time. Injected, so a test is deterministic. */
export type Context = {
  readonly newId: () => SessionId;
  readonly now: () => number;
};

export const NOOP: Noop = Object.freeze({ status: 'noop' });
export const unchanged = (state: PanelState): Step<Noop> => ({ state, result: NOOP });
export const refuse = (state: PanelState, reason: RefusedReason, message: string): Step<Refused> => ({ state, result: { status: 'refused', reason, message } });

/**
 * What a dictionary of the model holds under an id: an entry of its own, never a member the prototype chain brings. The dictionaries (`tools`, `sessions`, `active`) are plain objects keyed by ids
 * a plugin or a saved session gives, and `constructor` and `__proto__` are ids as legal as `s1`: `state.sessions['constructor']` is `Object`, a function, not "no session". Writes need no
 * care: a computed key in a literal or a spread makes an own property, `__proto__` included.
 */
export function own<T>(dictionary: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : undefined;
}

/**
 * An identifier a caller gives (a tool id, a plugin id): trimmed, as the registry trims what it registers, and never cut. Only the words a person reads (a title, a scope) are limited in length:
 * an identifier cut to fit would name nothing that is registered. Empty for anything that is not a non-empty string.
 */
export const identifier = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function emptyPanel(): PanelState {
  return Object.freeze({
    version: PANEL_VERSION,
    open: false,
    maximized: false,
    height: null,
    tool: null,
    active: Object.freeze({}),
    tools: Object.freeze({}),
    sessions: Object.freeze({}),
    order: Object.freeze([]),
    mounted: Object.freeze([]),
    panes: Object.freeze({}),
    live: Object.freeze([]),
    registered: 0,
  });
}

/** The state with some of its fields replaced. */
export function patch(state: PanelState, changes: Partial<PanelState>): PanelState {
  return Object.freeze({ ...state, ...changes });
}

/** Whether what a plugin brought shows: the host's own always does, a plugin's while it is live. */
export const isLive = (state: PanelState, owner: string): boolean => owner === HOST || state.live.includes(owner);

/** A tool is visible while its owner is live. */
export const toolVisible = (state: PanelState, tool: Tool): boolean => isLive(state, tool.owner);

/**
 * The visible tools, in order (R2). Lowest `order` first, as the mock sorts them (`shell-regions.js` `visibleTools`: `a.order - b.order || a.seq - b.seq`). A tie is settled by the place of the tool's owner: the host's
 * own tools lead (the mock registers them before any plugin's, and gives what a plugin declares one `seq` after them all), then the plugins in the order the caller listed them (`PanelState.live`: the mock lists plugins by
 * name and its rail is that list; the host lists them in the order of its rail), then `seq`, the order the owner declared its own tools in. Nothing in it is the order in which anything arrived, so two plugins that
 * finish loading at nearly the same time give the strip of every run, and a plugin that arrives late takes its place in it instead of the end of it.
 */
export function visibleTools(state: PanelState): Tool[] {
  const place = (tool: Tool): number => (tool.owner === HOST ? -1 : state.live.indexOf(tool.owner));
  return Object.values(state.tools)
    .filter((tool) => toolVisible(state, tool))
    .sort((a, b) => a.order - b.order || place(a) - place(b) || a.seq - b.seq);
}

/**
 * A session shows while its tool is registered and visible (with no tool there is nothing to draw its tab in) and its plugin is live, or the session is held: what its plugin's unload ended in a tool of
 * the host stays listed and mounted, ended, until its tab closes (A21). Nothing else of a plugin that is off shows (PO1).
 */
export function sessionVisible(state: PanelState, session: Session): boolean {
  const tool = own(state.tools, session.tool);
  return tool !== undefined && toolVisible(state, tool) && (isLive(state, session.plugin) || session.held === true);
}

/** The visible sessions of a tool, in the strip's order. */
export function visibleSessions(state: PanelState, tool: ToolId): Session[] {
  const out: Session[] = [];
  for (const id of state.order) {
    const session = own(state.sessions, id);
    if (session?.tool === tool && sessionVisible(state, session)) {
      out.push(session);
    }
  }

  return out;
}

/** The tool on screen: the one the user chose while it is visible, else the first visible one. */
export function effectiveTool(state: PanelState): ToolId | null {
  const chosen = state.tool === null ? undefined : own(state.tools, state.tool);
  if (chosen !== undefined && toolVisible(state, chosen)) {
    return chosen.id;
  }

  return visibleTools(state)[0]?.id ?? null;
}

/** The session of a tool on screen: the one the user chose while it is visible, else the first visible one of the tool. */
export function effectiveSession(state: PanelState, tool: ToolId): SessionId | null {
  const sessions = visibleSessions(state, tool);
  const chosen = own(state.active, tool);
  return sessions.find((session) => session.id === chosen)?.id ?? sessions[0]?.id ?? null;
}

/** What is on screen now, or `null` while the panel is hidden or has no tool to show. */
export function shownOf(state: PanelState): Shown | null {
  if (!state.open) {
    return null;
  }

  const tool = effectiveTool(state);
  return tool === null ? null : { tool, session: effectiveSession(state, tool) };
}

const sameIds = (a: readonly SessionId[], b: readonly SessionId[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * What every operation ends with: the sessions whose body is mounted are the ones that were mounted and are still there and visible, and the one that is on screen. A body is mounted
 * when it is first shown and stays until its session closes or its plugin leaves; the panel hiding unmounts nothing (HLT-32).
 */
export function settle(state: PanelState): PanelState {
  const reconciled = reconcilePanes(state);
  const keep = reconciled.mounted.filter((id) => {
    const session = own(reconciled.sessions, id);
    return session !== undefined && sessionVisible(reconciled, session);
  });
  const shown = shownOf(reconciled);
  // What is on screen is mounted: the tool's session, and every visible pane of its group.
  const group = shown === null ? undefined : own(reconciled.panes, shown.tool);
  const onScreen: SessionId[] = shown?.session === null || shown?.session === undefined ? [] : [shown.session];
  for (const pane of group?.panes ?? []) {
    const session = own(reconciled.sessions, pane.session);
    if (session !== undefined && sessionVisible(reconciled, session) && !onScreen.includes(pane.session)) {
      onScreen.push(pane.session);
    }
  }

  const next = onScreen.every((id) => keep.includes(id)) ? keep : [...keep, ...onScreen.filter((id) => !keep.includes(id))];
  return sameIds(next, reconciled.mounted) ? reconciled : patch(reconciled, { mounted: Object.freeze(next) });
}

/**
 * A tool with panes keeps its active session in its active pane. The session a tool has chosen (`active`) is the one the user just acted on: when it is in a pane, that pane is the active one; when it is in none
 * (a session opened in the tool, a tab chosen that no pane shows) it takes the active pane, and the session that pane had stays a tab of the tool, in no pane. A session the tool has not chosen yet, or one that is hidden, changes nothing.
 */
function reconcilePanes(state: PanelState): PanelState {
  let panes: Record<string, PaneGroup> | undefined;
  for (const [tool, group] of Object.entries(state.panes)) {
    const chosen = own(state.active, tool);
    const session = chosen === undefined ? undefined : own(state.sessions, chosen);
    if (chosen === undefined || session?.tool !== tool || !sessionVisible(state, session)) {
      continue;
    }

    const holding = group.panes.find((pane) => pane.session === chosen);
    let fixed: PaneGroup | undefined;
    if (holding === undefined) {
      fixed = { ...group, panes: group.panes.map((pane) => (pane.id === group.active ? { id: pane.id, session: chosen } : pane)) };
    } else if (holding.id !== group.active) {
      fixed = { ...group, active: holding.id };
    }

    if (fixed !== undefined) {
      panes ??= { ...state.panes };
      panes[tool] = Object.freeze({ ...fixed, panes: Object.freeze(fixed.panes) });
    }
  }

  return panes === undefined ? state : patch(state, { panes: Object.freeze(panes) });
}

/** The rules of the panes, as sentences. Written plainly, one group at a time, for the fuzz and the invariants test to apply. */
function paneProblems(state: PanelState): string[] {
  const problems: string[] = [];
  const heldBy = new Set<SessionId>();
  for (const [tool, group] of Object.entries(state.panes)) {
    if (group.axis !== 'row' && group.axis !== 'column') {
      problems.push(`the group of ${tool} has an axis that is neither row nor column`);
    }

    if (group.panes.length < 2) {
      problems.push(`the panes of ${tool} are fewer than two`);
    }

    const slots = new Set<string>();
    for (const pane of group.panes) {
      if (slots.has(pane.id)) {
        problems.push(`${tool} has two panes called ${pane.id}`);
      }

      slots.add(pane.id);
      if (own(state.sessions, pane.session)?.tool !== tool) {
        problems.push(`the pane ${pane.id} of ${tool} holds ${pane.session}, which is not a session of ${tool}`);
      }

      if (heldBy.has(pane.session)) {
        problems.push(`the session ${pane.session} is in two panes`);
      }

      heldBy.add(pane.session);
    }

    if (group.ratios.length !== group.panes.length) {
      problems.push(`${tool} has ${String(group.ratios.length)} ratios for ${String(group.panes.length)} panes`);
    }

    if (group.ratios.some((ratio) => !(Number.isFinite(ratio) && ratio > 0))) {
      problems.push(`a ratio of ${tool} is not above zero`);
    }

    const total = group.ratios.reduce((sum, ratio) => sum + ratio, 0);
    if (!(Math.abs(total - 1) <= RATIO_EPSILON)) {
      problems.push(`the ratios of ${tool} sum to ${String(total)}, not 1`);
    }

    const active = group.panes.find((pane) => pane.id === group.active);
    if (active === undefined) {
      problems.push(`the active pane of ${tool} is not one of its panes`);
    }

    const chosen = own(state.active, tool);
    const chosenSession = chosen === undefined ? undefined : own(state.sessions, chosen);
    if (active !== undefined && chosen !== undefined && chosenSession?.tool === tool && sessionVisible(state, chosenSession) && active.session !== chosen) {
      problems.push(`the active session of ${tool} is not the session of its active pane`);
    }
  }

  return problems;
}

/** The rules a sound state keeps, as sentences; an empty list means it is sound. The fuzz test applies it after every operation. */
export function checkInvariants(state: PanelState): string[] {
  const problems: string[] = [];
  if (state.version !== PANEL_VERSION) {
    problems.push(`the version is ${String(state.version)}`);
  }

  const ids = Object.keys(state.sessions);
  if (state.order.length !== ids.length || new Set(state.order).size !== state.order.length || state.order.some((id) => own(state.sessions, id) === undefined)) {
    problems.push('the order is not the sessions, each once');
  }

  for (const [id, session] of Object.entries(state.sessions)) {
    if (session.id !== id) {
      problems.push(`the session ${id} is recorded under another id`);
    }

    if (session.title === '' || session.tool === '' || session.plugin === '') {
      problems.push(`the session ${id} has no title, tool or plugin`);
    }

    const settled = session.state === 'ended' || session.state === 'failed';
    if (!settled && session.cause !== '') {
      problems.push(`the session ${id} is ${session.state} and has a cause`);
    }

    // A21: held is what a plugin's unload leaves listed. What it is, in words: a session of a tool of the host (a plugin's tool ids have a colon, the host's never do) that is over, ended or failed: what was
    // running ended with the unload, and what was over before it stayed as it was, so a held session may say no cause.
    if (session.held === true) {
      if (!settled) {
        problems.push(`the session ${id} is held and is not over`);
      }

      if (session.tool.includes(':')) {
        problems.push(`the session ${id} is held in ${session.tool}, which is not a tool of the host`);
      }
    }
  }

  for (const [tool, id] of Object.entries(state.active)) {
    if (own(state.sessions, id)?.tool !== tool) {
      problems.push(`the active session of ${tool} is not one of its sessions`);
    }
  }

  if (new Set(state.mounted).size !== state.mounted.length || state.mounted.some((id) => own(state.sessions, id) === undefined)) {
    problems.push('the mounted list holds a session twice or one that is not there');
  }

  const mountedHidden = state.mounted.find((id) => {
    const session = own(state.sessions, id);
    return session !== undefined && !sessionVisible(state, session);
  });
  if (mountedHidden !== undefined) {
    problems.push(`${mountedHidden} is mounted and not visible`);
  }

  // The same rule from the other side, written out from `live` and `held` and not from `sessionVisible`: of a plugin that is off, only a held session may have its body mounted.
  for (const id of state.mounted) {
    const session = own(state.sessions, id);
    if (session !== undefined && !isLive(state, session.plugin) && session.held !== true) {
      problems.push(`${id} is mounted, its plugin is off and it is not held`);
    }
  }

  if (state.height !== null && !(Number.isFinite(state.height) && state.height > 0)) {
    problems.push('the height is neither null nor a positive number');
  }

  for (const [id, tool] of Object.entries(state.tools)) {
    if (tool.id !== id || tool.label === '' || tool.owner === '') {
      problems.push(`the tool ${id} is not sound`);
    }
  }

  if (state.live.includes(HOST)) {
    problems.push('the host is listed as a live plugin: it always is');
  }

  problems.push(...paneProblems(state));

  return problems;
}
