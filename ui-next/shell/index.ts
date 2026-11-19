// The shell's public surface: the frame, the registration a screen hands it, and the tab model a host builds to drive it. Everything else in this directory is internal.
export { Shell } from './Shell';
export type { ShellProps } from './Shell';
export type { ShellAccent, ShellRail, ShellRailEntry, ShellRegistration, ShellScopeFace, ShellSidebar, ShellTreeNode } from './registration';
export type { PageTab } from './tabs/PageHost';
export { platformOf } from './core/chords';
export { createTabsStore, dispositionOf } from './core/tabs';
export type { Contributions, Description, Destination, Location, ModifierEvent, Route, RouteInput, TabId, TabsStore } from './core/tabs';
export { isNativeWindow } from './core/native';
