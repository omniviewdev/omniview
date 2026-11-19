import { createSaver as createDocumentSaver, type Saver } from '../saver';
import { serialise } from './persist';
import type { PersistedTabs, TabsState } from './types';

// The tab model's session, written one burst at a time (docs/ui-next/optimisations.md HSH-25, MNR-K2): the saver is the shell's (../saver.ts); this says what a tab model saves.

export type { Saver };

export type SaverOptions = {
  readonly store: { readonly getSnapshot: () => TabsState; readonly subscribe: (listener: () => void) => () => void };
  /** Receives the document to save. */
  readonly write: (value: PersistedTabs) => void;
  /** Quiet time after the last change before the write. Default 400 ms. */
  readonly delay?: number | undefined;
};

export function createSaver(options: SaverOptions): Saver {
  return createDocumentSaver({ ...options, serialise });
}
