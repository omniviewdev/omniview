import { createSaver, type Saver } from '../saver';
import { serialiseRecents } from './recents';
import type { PaletteState, PersistedPalette } from './types';

// The recents, written one burst at a time: the saver is the shell's (../saver.ts); this says what a palette saves. A query, the chips and the kind mean "now" and are not saved, so
// typing makes no write, and the document is written only when the recents themselves changed.

export type { Saver };

export type PaletteSaverOptions = {
  readonly store: { readonly getSnapshot: () => PaletteState; readonly subscribe: (listener: () => void) => () => void };
  /** Receives the document to save. */
  readonly write: (value: PersistedPalette) => void;
  /** Quiet time after the last change before the write. Default 400 ms. */
  readonly delay?: number | undefined;
};

export function createPaletteSaver(options: PaletteSaverOptions): Saver {
  return createSaver({ ...options, serialise: (state) => serialiseRecents(state.recents) });
}
