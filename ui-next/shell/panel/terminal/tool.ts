import type { IconName } from '@omniviewdev/kit';
import type { ToolInput } from '../../core/panel';

// The Terminal tool of the host (ch16 section H; the mock's `def('terminal', { title: 'Terminal', icon: 'LuSquareTerminal', kind: 'sessions', order: 10, ... })`): the one tool of the host that starts its own
// sessions. Its `+` and the button of its empty state start a shell of this machine; the sessions a plugin brings (a shell in a container) are a later slice (docs/ui-next/status/T1.md).

/** The panel's id for the tool: a host tool's id has no colon (a plugin's is `<plugin>:<tool>`). */
export const TERMINAL_TOOL_ID = 'terminal';

/** The glyph of the tool: the mock's `LuSquareTerminal` (icons.js:253), the kit's `square-terminal`: drawn by the tab, the card and the empty state. */
export const TERMINAL_ICON: IconName = 'square-terminal';

/** What the panel registers for it: the mock's words, glyph and place (Terminal 10, Logs 20, Problems 30, Operations 40): the first tool, and so the one the panel shows while nobody chose another. */
export const TERMINAL_TOOL: ToolInput = { id: TERMINAL_TOOL_ID, label: 'Terminal', icon: TERMINAL_ICON, order: 10 };

/** The label of the `+` and of the empty tool's button (the mock's `New terminal`). */
export const NEW_TERMINAL = 'New terminal';

/** The name of the menu beside the `+`, which lists the shells of this machine. */
export const CHOOSE_SHELL = 'Choose a shell';

/** What the tool says when it has no session, in the mock's words. */
export const TERMINAL_EMPTY = { title: 'No terminals', hint: 'Start a shell in this window. A session stays available when you switch tabs.' } as const;

/**
 * What the body of a session that has no feed says: the session is over and what it held is gone. It was restored from the last run, and the host listed no terminal for it when the window came back (T2-go): the host keeps
 * no terminal across a restart, and one that no window held for its lease (a few minutes) was ended. The way to a shell is the one that starts a new one.
 */
export const TERMINAL_GONE = { title: 'The earlier output is gone', hint: 'This terminal is not running any more: Omniview restarted, or this window was away for longer than a terminal is kept. Start a new terminal to continue.' } as const;
