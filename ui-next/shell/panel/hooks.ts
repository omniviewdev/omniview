import { useSyncExternalStore } from 'react';
import type { PaneLayout, PanelState, Session, SessionId, SessionItem, ToolId, ToolItem } from '../core/panel';
import type { ToolBadge, ToolBadges } from './badge';
import { usePanel } from './context';

// What a component of the panel reads of its model. One hook is one slice: the model hands back the same object while its slice is the same (core/panel/README.md), so
// `useSyncExternalStore` renders the component only when its own slice changed. The toggle reads `open`; a tool tab, its item; a session tab, its item; a body, its own session.

const NONE: readonly SessionId[] = Object.freeze([]);

/** A slice of the model. `select` must return an object that is the same while the slice is, or a primitive: the model's selectors do. */
export function usePanelSelector<T>(select: (state: PanelState) => T): T {
  const { store } = usePanel();
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}

/** Whether the panel is open: the status bar's toggle and the region. */
export function useOpen(): boolean {
  const { store } = usePanel();
  return usePanelSelector(store.selectors.open);
}

/** The remembered height: the region's size and the splitter's value. */
export function useHeight(): number | null {
  return usePanelSelector((state) => state.height);
}

/** The visible tools, in order. */
export function useToolIds(): readonly ToolId[] {
  const { store } = usePanel();
  return usePanelSelector(store.selectors.toolIds);
}

/** A host that gives no badges: no tab carries one, and nothing is subscribed to. One object, so a tab's subscription is not made again at every render. */
const NO_BADGES: ToolBadges = { subscribe: () => () => undefined, of: () => undefined };

/** What a tool tab carries beside its words: the host's badge for the tool, or nothing. The tab renders when its own badge changes. */
export function useToolBadge(tool: ToolId): ToolBadge | undefined {
  const { badges = NO_BADGES } = usePanel();
  return useSyncExternalStore(badges.subscribe, () => badges.of(tool));
}

export function useToolItem(id: ToolId): ToolItem | undefined {
  const { store } = usePanel();
  return usePanelSelector((state) => store.selectors.toolItem(state, id));
}

/** The tool on screen. */
export function useActiveTool(): ToolId | null {
  const { store } = usePanel();
  return usePanelSelector(store.selectors.activeTool);
}

/** The session tabs of a tool, in the order they were opened. */
export function useSessionIds(tool: ToolId | null): readonly SessionId[] {
  const { store } = usePanel();
  return usePanelSelector((state) => (tool === null ? NONE : store.selectors.sessionIds(state, tool)));
}

export function useSessionItem(id: SessionId): SessionItem | undefined {
  const { store } = usePanel();
  return usePanelSelector((state) => store.selectors.sessionItem(state, id));
}

/** The session on a tool's strip. */
export function useActiveSession(tool: ToolId | null): SessionId | null {
  const { store } = usePanel();
  return usePanelSelector((state) => (tool === null ? null : store.selectors.activeSession(state, tool)));
}

/** The sessions whose body is mounted. */
export function useMounted(): readonly SessionId[] {
  const { store } = usePanel();
  return usePanelSelector(store.selectors.mounted);
}

/** Whether this session's body is the one on screen. */
export function useIsShown(id: SessionId): boolean {
  const { store } = usePanel();
  return usePanelSelector((state) => store.selectors.isShown(state, id));
}

/** The record of one session: what its body and its card read. */
export function useSession(id: SessionId): Session | undefined {
  const { store } = usePanel();
  return usePanelSelector((state) => store.selectors.session(state, id));
}

/** Whether this session's plugin is off: only a session the unload ended and the panel kept (A21) is listed then, and what needs the plugin, the link back to its resource, cannot work until it returns. */
export function usePluginOff(id: SessionId): boolean {
  const { store } = usePanel();
  return usePanelSelector((state) => store.selectors.pluginOff(state, id));
}

const NO_GROUP = -1;

/**
 * Where a session's body sits in its tool's group of panes: its index, or -1 when the tool shows one session. Read straight from the group (one `findIndex`), not from a layout built for each of the
 * bodies that are mounted: with hundreds of mounted bodies a change of state would otherwise build hundreds of layouts.
 */
export function usePaneIndex(id: SessionId): number {
  return usePanelSelector((state) => {
    const tool = Object.hasOwn(state.sessions, id) ? state.sessions[id].tool : undefined;
    const group = tool !== undefined && Object.hasOwn(state.panes, tool) ? state.panes[tool] : undefined;
    return group === undefined ? NO_GROUP : group.panes.findIndex((pane) => pane.session === id);
  });
}

/** The stored share of a session's pane (1 when it has none): the body's `flex-grow`, so that the visible panes share the room in proportion even when one is hidden. */
export function usePaneShare(id: SessionId): number {
  return usePanelSelector((state) => {
    const tool = Object.hasOwn(state.sessions, id) ? state.sessions[id].tool : undefined;
    const group = tool !== undefined && Object.hasOwn(state.panes, tool) ? state.panes[tool] : undefined;
    const at = group === undefined ? NO_GROUP : group.panes.findIndex((pane) => pane.session === id);
    return group === undefined || at === NO_GROUP ? 1 : group.ratios[at];
  });
}

/** The slot id of a session's pane, or an empty string when it has none. */
export function usePaneId(id: SessionId): string {
  return usePanelSelector((state) => {
    const tool = Object.hasOwn(state.sessions, id) ? state.sessions[id].tool : undefined;
    const group = tool !== undefined && Object.hasOwn(state.panes, tool) ? state.panes[tool] : undefined;
    return group?.panes.find((pane) => pane.session === id)?.id ?? '';
  });
}

/** What a tool draws: its visible panes, their shares and the active one (`selectors.paneLayout`). */
export function usePaneLayout(tool: ToolId | null): PaneLayout | null {
  const { store } = usePanel();
  return usePanelSelector((state) => (tool === null ? null : store.selectors.paneLayout(state, tool)));
}

/** Whether this session's pane is its group's active one: the pane the keyboard last went into, which the layout marks so that a person can see where it is. */
export function usePaneActive(id: SessionId): boolean {
  return usePanelSelector((state) => {
    const tool = Object.hasOwn(state.sessions, id) ? state.sessions[id].tool : undefined;
    const group = tool !== undefined && Object.hasOwn(state.panes, tool) ? state.panes[tool] : undefined;
    return group?.panes.some((pane) => pane.session === id && pane.id === group.active) === true;
  });
}
