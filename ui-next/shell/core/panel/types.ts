// The bottom panel's model: its data, and the seam it calls through. Plain data only: no React, no DOM, nothing a plugin owns (ch16 section H; the mock's `shell-panel.js` and
// `shell-regions.js`). The panel is a region of tools; a tool holds sessions (a log stream, a shell); a session belongs to the plugin that opened it, and is a record of what the
// user is looking at, never a connection. What a session shows (its body) and what its card says are drawn by whoever owns the tool (ui-next/shell/panel/), and are not here.

import type { Json, Route } from '../tabs/types';

export type { Json, Route };

export type ToolId = string;
export type SessionId = string;

/** The owner of everything the host itself puts in the panel: always live. A plugin's id never is this. */
export const HOST = 'host';

/**
 * What a session is doing (ch16 section H, the state table). `starting` shows a loader after a second; `running` has no cue; `ended` is a session that finished or was ended, its output
 * kept and read-only; `failed` could not start, or broke after it ran. The mock also has `reconnecting` and `expired` (a session of the last run): a restored session is `ended`
 * here, and `reconnecting` is not built (docs/ui-next/status/P1a.md, "What later tools need").
 */
export type SessionState = 'starting' | 'running' | 'ended' | 'failed';

/** What the host knows about a tool: the tab's words and where it sits. Its body is the owner's. */
export type Tool = {
  readonly id: ToolId;
  /** `host`, or the id of the plugin that brought it. */
  readonly owner: string;
  /** The tab's text and accessible name: one or two words (S113). */
  readonly label: string;
  /** A glyph name. The model never reads it; the renderer draws the kit's glyph, or its generic one for a name it does not have. */
  readonly icon: string;
  /** Where the tool sits among the tools, lowest first. What it ties on is settled by the place of its owner among the live plugins (the host's own tools lead), then by `seq`. */
  readonly order: number;
  /**
   * The order the owner declared it in: a tool of the host takes the next place when it is registered, a plugin's tool its place in the list the plugin brought it in. What a tie in `order` between the tools of one
   * owner is settled by; it says nothing of when the owner arrived, so a plugin that loads late and the same plugin loaded first have the same tools in the same places.
   */
  readonly seq: number;
};

/** What a caller registers: a tool is made of this and the model's own `seq`. */
export type ToolInput = {
  readonly id: ToolId;
  readonly label: string;
  readonly icon: string;
  readonly order?: number | undefined;
};

export type Session = {
  readonly id: SessionId;
  readonly tool: ToolId;
  /**
   * The plugin that opened it, or `host`. A session of a plugin that is not live is hidden, and ended when it was running, except one that `held` keeps (A21): the sessions a plugin has in a tool of the
   * host are what its unload leaves listed.
   */
  readonly plugin: string;
  /** What the tab is called: the end of a long one is kept whole when it is cut (SCT1). */
  readonly title: string;
  /**
   * The person named this session (`renameSession`): its title is theirs, and its owner's own naming (`retitleSession`: the shell the host resolved, the title a program set) no longer changes it. Kept with the saved
   * session, so that a name survives a reload. Absent: the owner names it.
   */
  readonly titlePinned?: true | undefined;
  /** The muted qualifier after the name (the connection a twin is told apart by); empty when there is none. */
  readonly scope: string;
  readonly state: SessionState;
  /** When it entered its state, epoch milliseconds: the card says "Streaming · since 08:41". Only a change of state moves it. */
  readonly since: number;
  /** Why it ended or failed, in a sentence: what the card says under a failure. Empty while it runs. */
  readonly cause: string;
  /** The resource the session belongs to, as a link the card opens through the tab model (SCD1). Absent for a session that belongs to no resource. */
  readonly route?: Route | undefined;
  /**
   * Kept across its plugin's unload, in a tool of the host (A21): it stays listed, with its body mounted, while its plugin is off, until the user closes its tab; the lines a person is reading are theirs, and the
   * stream behind it is closed by the host. Whatever state it was in: a session that was running ended with the cause, one that had ended or failed on its own stays as it was. Only `syncPlugins` sets it, once,
   * with the end; after that the session never changes (a change of state is refused, a plugin that returns clears nothing) and a new session is a new press. A fact of this run: the saved panel never writes it
   * and a restored session is never held. Absent otherwise.
   */
  readonly held?: true | undefined;
};

/** What a caller opens a session with. The model adds the id (unless `id` is given) and the time. */
export type SessionInput = {
  readonly tool: ToolId;
  readonly plugin: string;
  readonly title: string;
  readonly scope?: string | undefined;
  readonly route?: unknown;
  /** Where it starts. Default: `starting`. */
  readonly state?: SessionState | undefined;
  readonly cause?: string | undefined;
  /** Another session of the same id is refused. Default: the model makes one. */
  readonly id?: SessionId | undefined;
};

export const PANEL_VERSION = 1;

/** The slot of a pane in its tool's group: `p1`, `p2`, ... A slot keeps its id while the session it shows changes; ids are never saved (a restored group numbers its slots again). */
export const LAYOUT_VERSION = 1;

export type PaneId = string;
/** The way a group lays its panes out. Only `row` (side by side) is drawn today; `column` (stacked) is in the shape so that a later layout needs no new saved form. */
export type PaneAxis = 'row' | 'column';
export type Pane = { readonly id: PaneId; readonly session: SessionId };

/**
 * The panes of one tool when it shows more than one session at once. A tool that has no group shows one session, the one `active` names, and behaves exactly as it did before panes existed.
 * A group always has two panes or more (a group that falls to one is dissolved), every pane holds one session of the tool, no session is in two panes, and `ratios` (one per pane, in order, each above zero)
 * sum to 1. `active` is the pane whose session is the tool's `active` session.
 */
export type PaneGroup = {
  readonly axis: PaneAxis;
  readonly panes: readonly Pane[];
  readonly ratios: readonly number[];
  readonly active: PaneId;
  /** The number the next slot is made from. */
  readonly seq: number;
};

export type PanelState = {
  readonly version: typeof PANEL_VERSION;
  /** The panel is shown (the status bar's toggle is pressed). A hidden panel is 0 px, never an empty strip (A2). */
  readonly open: boolean;
  readonly maximized: boolean;
  /**
   * The height the user chose, in pixels: remembered across hiding and showing, saved with the session. `null`: the default. What is drawn is this one within the window's limits
   * (`resolveHeight`, the twin of the stylesheet's `clamp()`), and a size that no longer fits the window is brought within it and kept so (`fitHeight`: the mock re-clamps on load and on resize).
   */
  readonly height: number | null;
  /** The tool the user chose. The tool on screen is this one while it is visible, else the first visible tool: a tool that went away leaves the choice standing for when it returns. */
  readonly tool: ToolId | null;
  /** Per tool, the session the user chose; the session on screen is this one while it is visible, else the first visible session of the tool. */
  readonly active: Readonly<Record<ToolId, SessionId>>;
  readonly tools: Readonly<Record<ToolId, Tool>>;
  readonly sessions: Readonly<Record<SessionId, Session>>;
  /** Every session in the strip's order: the order they were opened in, until the user moves one (`reorderSession`). */
  readonly order: readonly SessionId[];
  /**
   * The sessions whose body is mounted: shown at least once, and not closed. A session's body lives as long as the session does (docs/ui-next/optimisations.md HSH-32, HLT-32: a
   * streaming session keeps its buffer while another is on screen), so there is no cap; the panel being hidden unmounts nothing. A session whose plugin is not live is not mounted.
   */
  readonly mounted: readonly SessionId[];
  /** Per tool that shows more than one session at once, its panes (`PaneGroup`). A tool that is not here shows the one session `active` names. */
  readonly panes: Readonly<Record<ToolId, PaneGroup>>;
  /**
   * The plugins whose tools and sessions show (`host` always does), in the order the caller listed them (`syncPlugins`): a plugin's place in this list is the place its tools take among the tools that tie in
   * `order`. The host lists them in the order of the rail, so the place does not depend on the order the plugins arrived in.
   */
  readonly live: readonly string[];
  /** How many tools of the host were ever registered: the place the next one takes among them. */
  readonly registered: number;
};

export const LIMITS = Object.freeze({
  /** Sessions the saved session keeps, the newest first: a plugin that is never installed again must not keep its sessions for ever. */
  persistedSessions: 50,
  /** Characters of a title or a scope that the model keeps. */
  text: 200,
});

export type Done<T extends Record<string, unknown> = Record<string, unknown>> = { readonly status: 'done' } & T;
/** A legal request that changed nothing: the state is the same object, nobody is notified. */
export type Noop = { readonly status: 'noop' };
export type RefusedReason =
  /** No such tool, or no such session. */
  | 'missing'
  /** The tool or the session is not valid data (an empty id or title, a route that is not a route). */
  | 'invalid'
  /** The id is taken, or the tool limit is reached. */
  | 'taken'
  /** The session was ended by its plugin's unload and is kept as it is until its tab closes (A21): nothing changes it. */
  | 'held'
  /** The tool has no room for another pane: each pane needs its minimum along the axis (`PANE_MIN_PX`). */
  | 'full'
  /** The tool's panes are laid out on the other axis: a group has one axis, as a terminal group does. */
  | 'axis'
  /** The person named the session (`renameSession`): its owner may not name it again. */
  | 'pinned';
export type Refused = { readonly status: 'refused'; readonly reason: RefusedReason; readonly message: string };

export type PanelResult = Done | Noop | Refused;
export type OpenResult = Done<{ readonly id: SessionId }> | Refused;
/** A session closed: which, and the session now on its tool's strip (`null` when it was the last). */
export type CloseResult = Done<{ readonly closed: SessionId; readonly active: SessionId | null }> | Refused;

/** A pane added: the new session and the slot that shows it. */
export type SplitResult = Done<{ readonly id: SessionId; readonly pane: PaneId }> | Refused;

/** The pointer or the keys moved the splitter: the stored height is `size`; below the collapse threshold the panel hides instead and keeps its old height. */
export type Resize = { readonly size: number } | { readonly collapse: true };

/**
 * What a session tab shows (SCT1, TI1) and its accessible name: the words it DRAWS, and no others. The same object while the session and its twins are the same. The scope is drawn only when two listed sessions of
 * the tool share a title and not a scope (the mock's `labelParts`), so it is empty on a tab that has no such twin, whatever scope its session has (`Session.scope`: what its card and the saved panel read).
 */
export type SessionItem = {
  readonly id: SessionId;
  readonly tool: ToolId;
  /** The name as the plugin gave it. */
  readonly title: string;
  /** The part of the name that gives way with an ellipsis. */
  readonly head: string;
  /** The end of the name that stays whole, with the ordinal of a twin (` (2)`). */
  readonly tail: string;
  /** The muted qualifier the tab draws after its name: the session's scope while another session of its tool has its title and another scope, else empty. */
  readonly scope: string;
  /** The whole name, as drawn: title, ordinal and the scope the tab draws. No two tabs of a tool have one name. The tab's accessible name adds the state. */
  readonly name: string;
  readonly state: SessionState;
  readonly since: number;
};

/** What a tool tab shows. */
export type ToolItem = { readonly id: ToolId; readonly label: string; readonly icon: string };

/** What is on screen: the tool, and its session (none while the tool has none). `null` while the panel is hidden or has no tool. */
export type Shown = { readonly tool: ToolId; readonly session: SessionId | null };

/** What a tool's body draws: its visible panes in order, their shares (summing to 1) and the active one. A tool that shows one session has one pane and the ratio 1. The same object while it says the same. */
export type PaneLayout = {
  readonly axis: PaneAxis;
  readonly panes: readonly Pane[];
  readonly ratios: readonly number[];
  readonly active: PaneId;
};

/** What each part of the panel subscribes to. All are functions of the snapshot; the memoised ones return the same object while their slice is the same. */
export type Selectors = {
  /** The status bar's toggle. */
  readonly open: (state: PanelState) => boolean;
  /** The tool tabs, in order: the visible tools. */
  readonly toolIds: (state: PanelState) => readonly ToolId[];
  readonly toolItem: (state: PanelState, id: ToolId) => ToolItem | undefined;
  /** The tool the strip marks selected: `null` while there is no visible tool. */
  readonly activeTool: (state: PanelState) => ToolId | null;
  /** The session tabs of a tool, in the strip's order: the visible sessions. */
  readonly sessionIds: (state: PanelState, tool: ToolId) => readonly SessionId[];
  readonly sessionItem: (state: PanelState, id: SessionId) => SessionItem | undefined;
  /** The session the tool's strip marks selected: `null` while it has none. */
  readonly activeSession: (state: PanelState, tool: ToolId) => SessionId | null;
  /** The record of a visible session: what its body and its card read. */
  readonly session: (state: PanelState, id: SessionId) => Session | undefined;
  /** The sessions whose body is mounted, in the order they were first shown and never in the strip's: a session moved in its strip keeps its body where it is in the document. */
  readonly mounted: (state: PanelState) => readonly SessionId[];
  readonly shown: (state: PanelState) => Shown | null;
  /** The panes a tool draws, or `null` while it has no visible session. */
  readonly paneLayout: (state: PanelState, tool: ToolId) => PaneLayout | null;
  /** Whether this session's body is on screen: the panel is open, its tool is the tool on screen and it is the tool's session on screen, or a pane of that tool's group (every pane of a group is drawn). */
  readonly isShown: (state: PanelState, id: SessionId) => boolean;
  /**
   * Whether the session's plugin is off now. Only a held session can be listed while its plugin is off (A21), so this is what the card asks to say that what needs the plugin, the link back to the
   * resource, cannot work until it returns. `false` for a session that is not there.
   */
  readonly pluginOff: (state: PanelState, id: SessionId) => boolean;
};

/** A tool's panes as the saved panel keeps them: the sessions in order, the shares, and which pane was active (an index: slots are numbered again on the way back). */
export type PersistedPanes = {
  readonly axis: PaneAxis;
  readonly sessions: readonly SessionId[];
  readonly ratios: readonly number[];
  readonly active: number;
};

/** The saved layout of the panes. It has its own version so that the panel's does not move for it: a document without one is a panel whose tools each show one session (every panel saved before panes). */
export type PersistedLayout = {
  readonly version: typeof LAYOUT_VERSION;
  readonly tools: Readonly<Record<ToolId, PersistedPanes>>;
};

/** What a saved session holds of a session: its identity, never its state or its output. */
export type PersistedSession = {
  readonly id: SessionId;
  readonly tool: ToolId;
  readonly plugin: string;
  readonly title: string;
  readonly scope: string;
  /** The person named the session: kept, so that the name survives a reload. */
  readonly titlePinned?: true | undefined;
  readonly route?: Route | undefined;
};

/** What the session saves of the panel: the version first. */
export type PersistedPanel = {
  readonly version: typeof PANEL_VERSION;
  readonly open: boolean;
  readonly height: number | null;
  readonly tool: ToolId | null;
  readonly active: Readonly<Record<ToolId, SessionId>>;
  /** Oldest first. */
  readonly sessions: readonly PersistedSession[];
  /** Only a panel that has a tool with more than one pane writes it: every other panel saves exactly what it saved before panes. */
  readonly layout?: PersistedLayout | undefined;
};
