import type { ToolInput } from '../../core/panel';

// The Terminal tool of the host (ch16 section H; the mock's `def('terminal', { title: 'Terminal', icon: 'LuSquareTerminal', kind: 'sessions', order: 10, ... })`): the one tool of the host that starts its own
// sessions. Its `+` and the button of its empty state start a shell of this machine; the sessions a plugin brings (a shell in a container) are a later slice (docs/ui-next/status/T1.md).

/** The panel's id for the tool: a host tool's id has no colon (a plugin's is `<plugin>:<tool>`). */
export const TERMINAL_TOOL_ID = 'terminal';

/**
 * The glyph of the tool (the mock's `LuSquareTerminal`, icons.js:253): the tab, the card and the empty state read the name. The kit's registry does not have it yet (an icons step follows, status/T1.md lists it), so
 * until it does the panel draws its generic one for the name, which it is built to do for a name it does not know; nothing here changes when the glyph arrives.
 */
export const TERMINAL_ICON = 'square-terminal';

/** What the panel registers for it: the mock's words, glyph and place (Terminal 10, Logs 20, Problems 30, Operations 40): the first tool, and so the one the panel shows while nobody chose another. */
export const TERMINAL_TOOL: ToolInput = { id: TERMINAL_TOOL_ID, label: 'Terminal', icon: TERMINAL_ICON, order: 10 };

/** The label of the `+` and of the empty tool's button (the mock's `New terminal`). */
export const NEW_TERMINAL = 'New terminal';

/** What the tool says when it has no session, in the mock's words. */
export const TERMINAL_EMPTY = { title: 'No terminals', hint: 'Start a shell in this window. A session stays available when you switch tabs.' } as const;

/**
 * What the body of a session that has no feed says: the session is over and what it held is gone (it was restored from the last run: the host keeps no output across a restart, and reattaching to a shell that
 * is still running is a later slice), and the way to a shell is the one that starts a new one.
 */
export const TERMINAL_GONE = { title: 'The earlier output is gone', hint: 'This terminal ended when Omniview restarted. Start a new terminal to continue.' } as const;
