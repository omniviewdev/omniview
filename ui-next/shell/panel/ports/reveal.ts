import type { PanelStore } from '../../core/panel';
import { PORTS_TOOL_ID } from './tool';

/**
 * Shows the Ports tool: the panel opens on it, and a panel that is open comes to it. What the window does once a forward has started (the page that asked for it is where the person is, so the tool comes to them), and what the
 * mock's `Shell.panel.show('ports', { focus: false })` does: it moves no focus and starts nothing, and it tells nobody when the tool is already shown. A window with no Ports tool registered opens the panel on the tool it had (a tool that is
 * not there is ignored by the model).
 */
export function revealPortsTool(store: PanelStore): void {
  store.show({ tool: PORTS_TOOL_ID });
}
