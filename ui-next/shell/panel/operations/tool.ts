import type { IconName } from '@omniviewdev/kit';
import type { ToolInput } from '../../core/panel';

// The Operations tool of the host (ch16 S114: a singleton, "Problems and Operations"; the mock's `def('operations', { title: 'Operations', icon: 'LuActivity', order: 40, ... })`): the host's tasks, with their progress. It has no
// sessions, so the panel draws no strip of them and no `+`; the host draws its body (`OperationsBody`) while the tool is on screen with the panel open.

/** The panel's id for the tool: a host tool's id has no colon (a plugin's is `<plugin>:<tool>`). */
export const OPERATIONS_TOOL_ID = 'operations';

/** The glyph of the tool, in the kit's registry (`activity`: the mock's `LuActivity`); the tab and the empty state draw it. */
export const OPERATIONS_ICON: IconName = 'activity';

/** What the panel registers for it: the mock's words, glyph and place (Terminal 10, Logs 20, Problems 30, Operations 40). */
export const OPERATIONS_TOOL: ToolInput = { id: OPERATIONS_TOOL_ID, label: 'Operations', icon: OPERATIONS_ICON, order: 40 };

/** What the tool says when it has no operation, in the mock's words (shell-panel.js `operationsBody`). */
export const OPERATIONS_EMPTY = { title: 'No operations', hint: 'Operations you start and background work from plugins appear here.' } as const;

/**
 * What the tool says in place of that when the window could not read the activity service (`ActivityFeed.getError`): a failed read holds no task either, and "No operations" would say what the window does not know. The notice's detail is
 * the feed's own sentence, which is the host's to word.
 */
export const OPERATIONS_UNAVAILABLE = { title: 'Couldn\'t read operations' } as const;
