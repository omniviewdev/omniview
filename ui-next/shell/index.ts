// The shell's public surface: the frame, the registration a screen hands it, and the tab model a host builds to drive it. Everything else in this directory is internal.
export { Shell } from './Shell';
export type { ShellProps } from './Shell';
export type { ShellAccent, ShellRail, ShellRailEntry, ShellRegistration, ShellScopeFace, ShellSidebar, ShellTreeNode } from './registration';
export type { PageTab } from './tabs/PageHost';
export { platformOf } from './core/chords';
export { createTabsStore, dispositionOf, normaliseRoute } from './core/tabs';
export type { Contributions, Description, Destination, Location, ModifierEvent, Route, RouteInput, TabId, TabsStore } from './core/tabs';
export { isNativeWindow } from './core/native';
export { createPanelStore, restorePanel, createPanelSaver, toolIdOf, HOST as PANEL_HOST } from './core/panel';
export type { PanelStore, PanelState, PluginTools, Session as PanelSession, SessionInput as PanelSessionInput, SessionState as PanelSessionState, ToolInput as PanelToolInput } from './core/panel';
export type { PanelBindings, PanelCard, PanelCardAction, PanelEmpty, PanelLink, PanelNewSession } from './panel/host';
export { completeLogCard, createLogStreams, LogsBody, logCardOf, LOGS_EMPTY, LOGS_TOOL, LOGS_TOOL_ID } from './panel/logs';
export type { LogFeedHandle, LogOpened, LogStreams, LogTarget } from './panel/logs';
export { createRailChoice, loadSession, resolveWindowName, windowStorage } from './session';
export type { LoadedSession, RailChoice, WindowState } from './session';
