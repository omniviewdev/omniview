import type { LinkActivation } from '@omniviewdev/kit';
import type { ReactElement } from 'react';
import type { PanelStore, Route, Session, ToolId } from '../core/panel';

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
export type PanelNewSession = { readonly label: string; readonly start: () => void };

/** Where a resource link of a card goes: the address it shows (a real anchor, so the platform can copy it) and what choosing it does, as the tab model decides where it opens. */
export type PanelLink = { readonly href: string; readonly open: (activation: LinkActivation) => void };

export type PanelBindings = {
  readonly store: PanelStore;
  /**
   * Draws the body of a session. Called for every mounted body, `visible` for the one on screen. The host puts it in its own boundary: a body that throws loses that body only. An element or
   * nothing, never a `ReactNode`: that type includes a promise, which React suspends on, outside the boundary and with no fallback of the panel's own.
   */
  readonly renderBody: (session: Session, visible: boolean) => ReactElement | null;
  /** What the card of a session says; `undefined`: the host's default (the tool's words, the resource when the session has a route, the state). */
  readonly cardOf: (session: Session) => PanelCard | undefined;
  /** How a session starts from a tool; `undefined`: the tool has no `+`. */
  readonly newSessionOf: (tool: ToolId) => PanelNewSession | undefined;
  /** Where the resource of a session is: its address, and what opening it does. The shell knows no address grammar and no tab disposition: the host does. */
  readonly linkOf: (route: Route) => PanelLink;
};
