import { useSyncExternalStore } from 'react';
import { usePalette } from './context';
import { PaletteSurface } from './PaletteSurface';
import { usePaletteChords } from './usePaletteChords';

/**
 * The command palette of a window (ch16 S66): the chord that opens it, always, and its surface only while it is open. A closed palette draws nothing, holds no timer and listens to nothing but
 * that one chord; opening it mounts the surface, and closing unmounts it and everything it started.
 */
export function Palette() {
  const { store } = usePalette();
  const open = useSyncExternalStore(store.subscribe, () => store.getSnapshot().open);
  usePaletteChords();
  return open ? <PaletteSurface /> : null;
}
