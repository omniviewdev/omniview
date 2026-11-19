import { sameItems } from '../tabs/json';
import { SESSION_RULE, splitTitle } from '../title';
import { effectiveSession, effectiveTool, own, sessionVisible, shownOf, visibleSessions, visibleTools } from './state';
import type { PanelState, Selectors, Session, SessionId, SessionItem, Shown, Tool, ToolId, ToolItem } from './types';

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

/** The ordinal a twin is told apart by: the first of its name and scope has none, the second is (2). `at` is its place among the sessions of that name and scope, `count` how many there are. */
const ordinalText = (at: number, count: number): string => (count > 1 && at > 0 ? ` (${String(at + 1)})` : '');

function itemOf(session: Session, ordinal: string): SessionItem {
  const [head, end] = splitTitle(session.title, SESSION_RULE);
  return Object.freeze({
    id: session.id,
    tool: session.tool,
    title: session.title,
    head,
    tail: end + ordinal,
    scope: session.scope,
    name: `${session.title}${ordinal}${session.scope === '' ? '' : ` · ${session.scope}`}`,
    state: session.state,
    since: session.since,
  });
}

const EMPTY: readonly SessionId[] = Object.freeze([]);

/** Whether two items say the same: the old one is kept then, so the tab that shows it does not render. The tool is part of it: an id that is closed and opened again in another tool is another item. */
const sameItem = (a: SessionItem, b: SessionItem): boolean =>
  a.tool === b.tool && a.title === b.title && a.head === b.head && a.tail === b.tail && a.scope === b.scope && a.name === b.name && a.state === b.state && a.since === b.since;

/** The selectors of one store. Their caches belong to it: two stores share nothing. */
export function createSelectors(): Selectors {
  let derived: Derived | undefined;
  let mounted: { readonly source: PanelState['mounted']; readonly order: PanelState['order']; readonly list: readonly SessionId[] } | undefined;
  let shown: Shown | null = null;

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
      // Twins are the sessions of one name and scope: grouped once, so a strip of n tabs costs n and not n squared.
      const twins = new Map<string, number>();
      for (const session of sessions) {
        const key = `${session.title}\u0000${session.scope}`;
        twins.set(key, (twins.get(key) ?? 0) + 1);
      }

      const seen = new Map<string, number>();
      for (const session of sessions) {
        const key = `${session.title}\u0000${session.scope}`;
        const at = seen.get(key) ?? 0;
        seen.set(key, at + 1);
        const ordinal = ordinalText(at, twins.get(key) ?? 1);
        const before = derived?.items.get(session.id);
        const item = itemOf(session, ordinal);
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
      if (mounted?.source === state.mounted && mounted.order === state.order) {
        return mounted.list;
      }

      const list = sameItems(mounted?.list, Object.freeze(state.order.filter((id) => state.mounted.includes(id))));
      mounted = { source: state.mounted, order: state.order, list };
      return list;
    },
    shown: (state) => {
      const next = shownOf(state);
      if (next?.tool !== shown?.tool || next?.session !== shown?.session) {
        shown = next === null ? null : Object.freeze(next);
      }

      return shown;
    },
    isShown: (state, id) => shownOf(state)?.session === id,
  };
}
