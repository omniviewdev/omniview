import type { IconName } from '@omniviewdev/kit';
import type { ToolInput } from '../../core/panel';

// The Logs tool of the host (ch16 section H; the mock's `def('logs', { title: 'Logs', icon: 'LuScrollText', order: 20 })`): the one tool the host owns that plugins fill. The host draws its sessions (the kit's
// log view over the feed a plugin handed over); a plugin draws nothing in it, it opens sessions from a resource (owner decision A20), so the tool has no `+` and no button of its own to start one.

/** The panel's id for the tool: a host tool's id has no colon (a plugin's is `<plugin>:<tool>`). */
export const LOGS_TOOL_ID = 'logs';

/** The glyph of the tool, in the kit's registry (`scroll-text`: the mock's `LuScrollText`); the tab, the card and the empty states draw it. */
export const LOGS_ICON: IconName = 'scroll-text';

/** What the panel registers for it: the mock's words, glyph and place (Terminal 10, Logs 20, Problems 30, Operations 40). */
export const LOGS_TOOL: ToolInput = { id: LOGS_TOOL_ID, label: 'Logs', icon: LOGS_ICON, order: 20 };

/** What the tool says when it has no session: how one arrives, in the mock's words, and no button (decision A20: sessions start from the resource, never from the panel; the mock's has an `Open logs…` button). */
export const LOGS_EMPTY = { title: 'No log sessions', hint: 'Open the logs of a resource to follow them here.' } as const;

/**
 * What the body of a session that has no stream says: the session is over and what it held is gone (it was restored from the last run, or its plugin was unloaded and came back; the host keeps no line
 * across either, which belongs to the buffer policy of row P1c), and the way to get logs again is the one that started it (decision A20).
 */
export const LOGS_GONE = { title: 'The earlier lines are gone', hint: 'Open logs from the resource to follow them again.' } as const;
