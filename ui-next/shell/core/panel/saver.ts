import type { Saver } from '../saver';
import { createSaver } from '../saver';
import { serialise } from './persist';
import type { PanelState, PersistedPanel } from './types';

// The panel's session, written one burst at a time (docs/ui-next/optimisations.md HLT-36): the saver is the shell's (../saver.ts); this says what a panel saves. Dragging the splitter
// commits the height once, on release, so a drag makes one write, and ten changes inside 400 ms make one.

export type PanelSaverOptions = {
  readonly store: { readonly getSnapshot: () => PanelState; readonly subscribe: (listener: () => void) => () => void };
  /** Receives the document to save. */
  readonly write: (value: PersistedPanel) => void;
  /** Quiet time after the last change before the write. Default 400 ms. */
  readonly delay?: number | undefined;
};

export function createPanelSaver(options: PanelSaverOptions): Saver {
  return createSaver({ ...options, serialise });
}
