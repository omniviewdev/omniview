import { sameItems } from '../tabs/json';
import { SESSION_RULE, splitTitle } from '../title';
import { heardAs, sameWords } from './names';
import { effectiveSession, effectiveTool, isLive, own, sessionVisible, shownOf, visibleSessions, visibleTools } from './state';
import type { PaneLayout, PanelState, Selectors, Session, SessionId, SessionItem, Shown, Tool, ToolId, ToolItem } from './types';

// What the toggle, the tool strip, a session tab and a tool body each subscribe to. Every selector is a function of the snapshot. One that only reads a part of the state returns that
// part, which is the same object while it did not change (the state is updated by structural sharing); one that derives a list or an object keeps its last answer and hands it back while
// its content is the same. So a session changing state changes what reads that session and nothing that reads another (docs/ui-next/optimisations.md HLT-33: a tab-list update renders
// no mounted viewer; MNR-T16's rule for rows, applied to tabs).

type Derived = {
  readonly tools: PanelState['tools'];
  readonly live: PanelState['live'];
  readonly sessions: PanelState['sessions'];
  readonly order: PanelState['order'];
  readonly toolIds: readonly ToolId[];
  readonly toolItems: ReadonlyMap<ToolId, ToolItem>;
  readonly strips: ReadonlyMap<ToolId, readonly SessionId[]>;
  readonly items: ReadonlyMap<SessionId, SessionItem>;
};

const toolItemOf = (tool: Tool): ToolItem => Object.freeze({ id: tool.id, label: tool.label, icon: tool.icon });

const sameToolItem = (item: ToolItem, tool: Tool): boolean => item.label === tool.label && item.icon === tool.icon;

/** What a tab draws of its session besides the title: the ordinal of a twin (` (2)`, or none) and the scope, which is empty unless the tab draws it. */
type Face = { readonly ordinal: string; readonly scope: string };

/** The ordinal a twin is told apart by: the first of its title and scope has none, the second is (2). */
const ordinalOf = (number: number): string => (number === 1 ? '' : ` (${String(number)})`);

/** The name a tab has: its title, its ordinal and, when it draws one, its scope. The same words the tab draws, in the order it draws them. */
const nameOf = (title: string, ordinal: string, scope: string): string => `${title}${ordinal}${scope === '' ? '' : ` · ${scope}`}`;

const groupOf = (session: Session): string => `${session.title}\u0000${session.scope}`;

/**
 * What the tabs of one tool draw of their sessions, from the sessions that are listed, oldest first (the mock's `labelParts`, shell-panel.js:207-221; SCT1, TI1). Two rules, and a name that is always
 * its own:
 *
 *   - the SCOPE is drawn only to tell twins apart: on a session whose title is shared with another listed session that has another scope, and on that one too. A session that has no twin, or whose twins
 *     are all of its scope, draws none: a tab that says nothing of the connection it belongs to is the way of every tab in the strip, and its card says it;
 *   - the ORDINAL tells apart the sessions of one title AND one scope: the first has none, the second is (2).
 *
 * A tab is HEARD as its name and, when its session is not steady, its state (`task, ended`: names.ts), and a person who cannot see the strip has nothing else to tell two tabs by; the name is also what the tab DRAWS
 * (`SessionItem.name` is its own). So no two tabs of a strip may be drawn alike or heard alike, runs of white space counting as one space (names.ts, `sameWords`): a number whose drawn name or whose sound is already
 * another tab's (a title that looks like `a (2)` beside two sessions of `a`, or like another session's name and state, an ended `task` beside a running `task, ended`) is skipped, the later session being the one that is
 * told another number. Grouped once, so a strip of n tabs costs n and not n squared.
 */
function facesOf(sessions: readonly Session[]): ReadonlyMap<SessionId, Face> {
  const scopesOfTitle = new Map<string, Set<string>>();
  const sizeOfGroup = new Map<string, number>();
  for (const session of sessions) {
    const scopes = scopesOfTitle.get(session.title) ?? new Set<string>();
    scopes.add(session.scope);
    scopesOfTitle.set(session.title, scopes);
    sizeOfGroup.set(groupOf(session), (sizeOfGroup.get(groupOf(session)) ?? 0) + 1);
  }

  const faces = new Map<SessionId, Face>();
  const placeInGroup = new Map<string, number>();
  const takenDrawn = new Set<string>();
  const takenHeard = new Set<string>();
  for (const session of sessions) {
    const group = groupOf(session);
    const at = placeInGroup.get(group) ?? 0;
    placeInGroup.set(group, at + 1);
    const scope = session.scope !== '' && (scopesOfTitle.get(session.title)?.size ?? 0) > 1 ? session.scope : '';
    let number = (sizeOfGroup.get(group) ?? 1) > 1 && at > 0 ? at + 1 : 1;
    const drawnWith = (n: number): string => nameOf(session.title, ordinalOf(n), scope);
    const free = (n: number): boolean => !takenDrawn.has(sameWords(drawnWith(n))) && !takenHeard.has(sameWords(heardAs(drawnWith(n), session.state)));
    while (!free(number)) {
      number += 1;
    }

    takenDrawn.add(sameWords(drawnWith(number)));
    takenHeard.add(sameWords(heardAs(drawnWith(number), session.state)));
    faces.set(session.id, { ordinal: ordinalOf(number), scope });
  }

  return faces;
}

function itemOf(session: Session, face: Face): SessionItem {
  const [head, end] = splitTitle(session.title, SESSION_RULE);
  return Object.freeze({
    id: session.id,
    tool: session.tool,
    title: session.title,
    head,
    tail: end + face.ordinal,
    scope: face.scope,
    name: nameOf(session.title, face.ordinal, face.scope),
    state: session.state,
    since: session.since,
  });
}

const EMPTY: readonly SessionId[] = Object.freeze([]);

const SOLE_PANE = 'p1';

/**
 * What a tool draws: the panes of its group whose sessions are visible, with their shares in proportion (the stored shares are not touched: a pane whose plugin returns has its own back), the active one
 * being the pane of the session the tool shows. A tool with no group, or with one visible pane left, draws one pane of the whole. A tool with no visible session draws nothing.
 */
function layoutOf(state: PanelState, tool: ToolId): PaneLayout | null {
  const shown = effectiveSession(state, tool);
  if (shown === null) {
    return null;
  }

  const group = own(state.panes, tool);
  const visible = group === undefined ? [] : group.panes.flatMap((pane, index) => (visibleSessions(state, tool).some((one) => one.id === pane.session) ? [index] : []));
  if (group !== undefined && visible.length >= 2) {
    const panes = visible.map((index) => group.panes[index]);
    const whole = visible.length === group.panes.length;
    const total = visible.reduce((sum, index) => sum + group.ratios[index], 0);
    return { axis: group.axis, panes, ratios: whole ? group.ratios : visible.map((index) => group.ratios[index] / total), active: panes.find((pane) => pane.session === shown)?.id ?? panes[0].id };
  }

  return { axis: 'row', panes: [{ id: group?.panes.find((pane) => pane.session === shown)?.id ?? SOLE_PANE, session: shown }], ratios: [1], active: group?.panes.find((pane) => pane.session === shown)?.id ?? SOLE_PANE };
}

const sameLayout = (a: PaneLayout | null, b: PaneLayout | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.axis === b.axis &&
    a.active === b.active &&
    a.panes.length === b.panes.length &&
    a.panes.every((pane, index) => pane.id === b.panes[index].id && pane.session === b.panes[index].session) &&
    a.ratios.every((ratio, index) => ratio === b.ratios[index]));

/** Whether two items say the same: the old one is kept then, so the tab that shows it does not render. The tool is part of it: an id that is closed and opened again in another tool is another item. */
const sameItem = (a: SessionItem, b: SessionItem): boolean =>
  a.tool === b.tool && a.title === b.title && a.head === b.head && a.tail === b.tail && a.scope === b.scope && a.name === b.name && a.state === b.state && a.since === b.since;

/** The selectors of one store. Their caches belong to it: two stores share nothing. */
export function createSelectors(): Selectors {
  let derived: Derived | undefined;
  let mounted: { readonly source: PanelState['mounted']; readonly list: readonly SessionId[] } | undefined;
  let shown: Shown | null = null;
  const layouts = new Map<ToolId, PaneLayout | null>();

  const derive = (state: PanelState): Derived => {
    if (derived?.tools === state.tools && derived.live === state.live && derived.sessions === state.sessions && derived.order === state.order) {
      return derived;
    }

    const tools = visibleTools(state);
    const toolItems = new Map<ToolId, ToolItem>();
    for (const tool of tools) {
      const before = derived?.toolItems.get(tool.id);
      toolItems.set(tool.id, before !== undefined && sameToolItem(before, tool) ? before : toolItemOf(tool));
    }

    const items = new Map<SessionId, SessionItem>();
    const strips = new Map<ToolId, readonly SessionId[]>();
    for (const tool of tools) {
      const sessions = visibleSessions(state, tool.id);
      const faces = facesOf(sessions);
      for (const session of sessions) {
        const before = derived?.items.get(session.id);
        const item = itemOf(session, faces.get(session.id) ?? { ordinal: '', scope: '' });
        items.set(session.id, before !== undefined && sameItem(before, item) ? before : item);
      }

      strips.set(tool.id, sameItems(derived?.strips.get(tool.id), Object.freeze(sessions.map((session) => session.id))));
    }

    derived = {
      tools: state.tools,
      live: state.live,
      sessions: state.sessions,
      order: state.order,
      toolIds: sameItems(derived?.toolIds, Object.freeze(tools.map((tool) => tool.id))),
      toolItems,
      strips,
      items,
    };
    return derived;
  };

  return {
    open: (state) => state.open,
    toolIds: (state) => derive(state).toolIds,
    toolItem: (state, id) => derive(state).toolItems.get(id),
    activeTool: effectiveTool,
    sessionIds: (state, tool) => derive(state).strips.get(tool) ?? EMPTY,
    sessionItem: (state, id) => derive(state).items.get(id),
    activeSession: effectiveSession,
    session: (state, id) => {
      const session = own(state.sessions, id);
      return session !== undefined && sessionVisible(state, session) ? session : undefined;
    },
    mounted: (state) => {
      if (mounted?.source === state.mounted) {
        return mounted.list;
      }

      const list = sameItems(mounted?.list, state.mounted);
      mounted = { source: state.mounted, list };
      return list;
    },
    shown: (state) => {
      const next = shownOf(state);
      if (next?.tool !== shown?.tool || next?.session !== shown?.session) {
        shown = next === null ? null : Object.freeze(next);
      }

      return shown;
    },
    paneLayout: (state, tool) => {
      const next = layoutOf(state, tool);
      const before = layouts.get(tool);
      if (before !== undefined && sameLayout(before, next)) {
        return before;
      }

      layouts.set(tool, next === null ? null : Object.freeze(next));
      return layouts.get(tool) ?? null;
    },
    isShown: (state, id) => shownOf(state)?.session === id,
    pluginOff: (state, id) => {
      const session = own(state.sessions, id);
      return session !== undefined && !isLive(state, session.plugin);
    },
  };
}
