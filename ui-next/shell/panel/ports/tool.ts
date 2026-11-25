import { isIconName, type IconName } from '@omniviewdev/kit';
import type { ToolInput } from '../../core/panel';

// The Ports tool of the host (ch16 section H; the mock's `Shell.panel.tool('ports', { title: 'Ports', icon: 'LuCable', order: 25, ... })`): the forwards of ports the host reports, in a table. Unlike the Logs and the Terminal
// tools it has no sessions: it is one list for the whole window, so it is registered as any tool of the host is and drawn by the host's `renderTool` (`../host.ts`) while it is on screen.

/** The panel's id for the tool: a host tool's id has no colon (a plugin's is `<plugin>:<tool>`). */
export const PORTS_TOOL_ID = 'ports';

/** The glyph the design wants if the registry has it, else the nearest it has: the day the registry knows the name this is the name, with nothing else to change (`terminal/tool.ts` does the same for its glyph). */
const prefer = (wanted: string, fallback: IconName): IconName => (isIconName(wanted) ? wanted : fallback);

/** The tool's glyph: the mock's `LuCable`; the registry's nearest is the network. */
export const PORTS_ICON: IconName = prefer('cable', 'network');
/** Stop: the mock's `LuSquare`; the registry's nearest is the cross. */
export const STOP_ICON: IconName = prefer('square', 'close');
/** Open in browser: the registry has no arrow out of a box yet; its nearest is the globe. */
export const OPEN_ICON: IconName = prefer('external-link', 'globe');

/** What the panel registers for it: the mock's words, glyph and place (Terminal 10, Logs 20, Ports 25, Problems 30, Operations 40). */
export const PORTS_TOOL: ToolInput = { id: PORTS_TOOL_ID, label: 'Ports', icon: PORTS_ICON, order: 25 };

/** What the tool says when the host lists no forward: how one arrives, in the mock's words, and no button (a forward starts from a resource, so the tool has no start of its own). */
export const PORTS_EMPTY = { title: 'No forwarded ports', hint: 'Forward a port of a resource to this computer.' } as const;
