import { isIconName, type IconName } from '@omniviewdev/kit';
import type { ToolInput } from '../../core/panel';

// The Problems tool of the host (ch16 S114, S121; the mock's `def('problems', { title: 'Problems', icon: 'LuTriangleAlert', order: 30 })`): a singleton, with no sessions, no strip and no `+`. It lists the conditions that are
// true now (S74), and its tab carries their count (`./model.ts`, the badge).

/** The panel's id for the tool: a host tool's id has no colon (a plugin's is `<plugin>:<tool>`). */
export const PROBLEMS_TOOL_ID = 'problems';

// The glyphs of the tool are the mock's Lucide glyphs. The kit's registry does not have these names yet (`triangle-alert`, `circle-check`, `external-link`), so until it does each is the nearest glyph it has; the day the
// registry knows a name this is the name, with nothing else to change.

/** The tab's glyph: the mock's `LuTriangleAlert`; the nearest the registry has is the warning triangle. */
const WANTED_ICON = 'triangle-alert';
export const PROBLEMS_ICON: IconName = isIconName(WANTED_ICON) ? WANTED_ICON : 'status-warning';

/** The glyph of the empty state: the mock's `LuCircleCheck`; the nearest the registry has is the success mark. */
const WANTED_EMPTY_ICON = 'circle-check';
export const PROBLEMS_EMPTY_ICON: IconName = isIconName(WANTED_EMPTY_ICON) ? WANTED_EMPTY_ICON : 'status-success';

/** The glyph of a row's open button: the mock's `LuExternalLink`; the nearest the registry has is the arrow. */
const WANTED_OPEN_ICON = 'external-link';
export const OPEN_ICON: IconName = isIconName(WANTED_OPEN_ICON) ? WANTED_OPEN_ICON : 'arrow-right';

/** What the panel registers for it: the mock's words, glyph and place (Terminal 10, Logs 20, Problems 30, Operations 40). */
export const PROBLEMS_TOOL: ToolInput = { id: PROBLEMS_TOOL_ID, label: 'Problems', icon: PROBLEMS_ICON, order: 30 };

/** What the tool says when no condition is true, in the mock's words (shell-panel.js 2223). */
export const PROBLEMS_EMPTY = { title: 'No problems', hint: 'Plugins and connections are healthy.' } as const;
