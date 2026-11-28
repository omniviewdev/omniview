// What the body takes for the terminal's pointer and keyboard menu and for the links in its output (T3a): two hooks, the one place the body imports them from. The menu is here; the links are in `../links` (their rules, their
// tooltip and its stylesheet) and are exported from here with it, as the body's composition has them.
export { useTerminalLinks } from '../links/useTerminalLinks';
export type { TerminalLinks, TerminalLinksOptions, TerminalLinksScreen } from '../links/useTerminalLinks';
export { useTerminalMenu } from './useTerminalMenu';
export type { TerminalMenu, TerminalMenuHost, TerminalMenuLinks, TerminalMenuOptions, TerminalMenuScreen } from './useTerminalMenu';
