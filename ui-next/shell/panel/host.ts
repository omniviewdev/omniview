import type { LinkActivation, MenuItem, MenuSource } from '@omniviewdev/kit';
import type { ReactElement } from 'react';
import type { PanelStore, Route, Session, SessionId, ToolId } from '../core/panel';
import type { ToolBadges } from './badge';

// What the shell asks of its host to draw the panel. The shell knows a tool by the data the model holds (an id, a label, a glyph) and a session by its record; what a session's body draws and
// what its card says are the owner's (a plugin's, or the host's own tool's), so the host hands the shell these answers and the shell never reads a plugin. Plain data and functions.

/** A button of a session card: its label, an optional glyph, what it does, and the reason it cannot now. */
export type PanelCardAction = {
  readonly label: string;
  readonly icon?: string | undefined;
  readonly onSelect: () => void;
  readonly disabledReason?: string | undefined;
};

/**
 * What the card of a session says (ch16 SCD1): the kind of session, the resource it belongs to as a link, a compact list of facts, what it does and since when, at most two buttons. Every
 * member is optional; the shell fills in what is missing (the tool's own words, the state of the session) and puts `Open <resource>` first when the resource has a route.
 */
export type PanelCard = {
  readonly kind?: string | undefined;
  readonly icon?: string | undefined;
  readonly resource?: { readonly label: string; readonly kind?: string | undefined; readonly icon?: string | undefined; readonly route?: Route | undefined } | undefined;
  readonly facts?: ReadonlyArray<readonly [label: string, text: string]> | undefined;
  readonly state?: { readonly label?: string | undefined; readonly reason?: string | undefined } | undefined;
  readonly actions?: readonly PanelCardAction[] | undefined;
};

/** How a session starts from its tool: the label of the `+` and of the empty tool's button, and the start. */
export type PanelNewSession = { readonly label: string; readonly start: () => void; readonly menu?: PanelNewSessionMenu | undefined };

/**
 * What a tool offers to start besides its default, as the items of the kit's menu (an arrow beside the `+` opens them): the name of the menu, the items now, and the way to hear that they changed. `getSnapshot` answers the same
 * list until the items change, which is what a store read by the panel requires. A tool with no items has no arrow.
 */
export type PanelNewSessionMenu = {
  readonly label: string;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => readonly MenuItem[];
};

/** What a tool with no session says, in its owner's words: what is missing, and how one arrives. */
export type PanelEmpty = { readonly title: string; readonly hint: string };

/** Where a resource link of a card goes: the address it shows (a real anchor, so the platform can copy it) and what choosing it does, as the tab model decides where it opens. */
export type PanelLink = { readonly href: string; readonly open: (activation: LinkActivation) => void };

/** The host composes only the invoking session's menu. Built-in actions stay under the control of the shell. */
export type TerminalMenuPlacement = (id: SessionId, surface: 'session-tab' | 'terminal-body', items: readonly MenuItem[]) => readonly MenuItem[] | MenuSource;

export type PanelBindings = {
  readonly store: PanelStore;
  readonly terminalMenu?: TerminalMenuPlacement | undefined;
  readonly terminalMenuContent?: ReactElement | undefined;
  /**
   * Draws the body of a session. Called for every mounted body, `visible` for the one on screen. The host puts it in its own boundary: a body that throws loses that body only. An element or
   * nothing, never a `ReactNode`: that type includes a promise, which React suspends on, outside the boundary and with no fallback of the panel's own.
   */
  readonly renderBody: (session: Session, visible: boolean) => ReactElement | null;
  /** What the card of a session says; `undefined`: the host's default (the tool's words, the resource when the session has a route, the state). */
  readonly cardOf: (session: Session) => PanelCard | undefined;
  /** How a session starts from a tool; `undefined`: the tool has no `+`. */
  readonly newSessionOf: (tool: ToolId) => PanelNewSession | undefined;
  /**
   * What a tool with no session says, when its owner words it (the Logs tool says sessions start from a resource, and has no button: decision A20); `undefined`, or the member absent: the generic words,
   * and the button that starts a session when `newSessionOf` has one.
   */
  readonly emptyOf?: ((tool: ToolId) => PanelEmpty | undefined) | undefined;
  /**
   * Draws a tool that has no sessions (a singleton, ch16 S114: Problems and Operations), or `undefined` for a tool that has them. It is asked only for the tool that is on screen while the panel is open, so the host
   * does no work for a tool nobody is looking at, and what it returns is dropped when the tool leaves the screen or the panel is hidden: a singleton holds no stream, so nothing of it is kept mounted. The host puts the
   * element in its own boundary, as it does a session's body. A tool it draws has no strip of sessions, no `+` and no empty state. Member absent: every tool has sessions.
   */
  readonly renderTool?: ((tool: ToolId) => ReactElement | undefined) | undefined;
  /** What each tool tab carries beside its words: a count or a dot (`badge.ts`). Member absent: no tab carries one. */
  readonly badges?: ToolBadges | undefined;
  /** What stops a session and keeps its tab (Stop session), or `undefined` when the host holds nothing of it to stop. Member absent: the menu has no Stop. */
  readonly stopOf?: ((id: SessionId) => (() => void) | undefined) | undefined;
  /** Where the resource of a session is: its address, and what opening it does. The shell knows no address grammar and no tab disposition: the host does. */
  readonly linkOf: (route: Route) => PanelLink;
};
