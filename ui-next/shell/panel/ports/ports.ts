import { createElement, type ReactElement } from 'react';
import type { PanelStore } from '../../core/panel';
import { productionPorts, type PortsDeps } from './api';
import { PortsBody } from './PortsBody';
import { createPortsStore, type PortsStore } from './PortsStore';
import { revealPortsTool } from './reveal';

// The Ports tool as the host plugs it in (docs/ui-next/status/PF1.md), behind one object, so that the host's wiring is a line for each thing the panel asks and the tool's own rules stay in this folder: the store of the forwards, the
// body the panel draws while the tool is on screen, and the way to show the tool.

/**
 * What the window gives the tool. Everything but the way to open an address is the runtime's own by default (the networker's calls, the events, the clipboard the Logs and the Terminal copy with, the host's error reading); a test or a
 * probe gives others. The way to open an address is required: the tool draws Open in browser because there is a way to do it, and the window is what knows it (the host's own call, `plugins/host/openExternal.ts`).
 */
export type PortsOptions = Partial<PortsDeps> & Pick<PortsDeps, 'openExternal'>;

export type Ports = {
  readonly store: PortsStore;
  /** The body of the tool, for the host's `renderTool`. The same element every time: the panel asks for it whenever it renders, and a body that has not changed is not rendered for that. */
  readonly bodyOf: () => ReactElement;
  /** Shows the tool: what a window does once a forward has started. */
  readonly reveal: () => void;
};

export function createPorts(panel: PanelStore, options: PortsOptions): Ports {
  const store = createPortsStore({ ...productionPorts, ...options });
  const body = createElement(PortsBody, { store });
  return {
    store,
    bodyOf: () => body,
    reveal: () => {
      revealPortsTool(panel);
    },
  };
}
