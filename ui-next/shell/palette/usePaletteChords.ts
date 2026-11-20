import { useEffect } from 'react';
import { platformOf } from '../core/chords';
import { blocksUnderModal, paletteChordOf } from './chords';
import { usePalette } from './context';

/**
 * The palette's chords, on the window for as long as the shell is mounted (ch16 S66): Command K on a Mac and Control K elsewhere toggle the palette from anywhere, a text field included, and
 * the key is the palette's alone (it is not offered to anything else). While the palette is open the window's own chords (close and jump to a tab, toggle the panel) are taken from the page
 * behind it: they are marked as handled before the listeners that would act on them see them. `chords.ts` holds the rules. The listener is in the capture phase on the window so it sees the key first.
 * This is the one thing a closed palette holds: nothing else of it listens or waits.
 */
export function usePaletteChords(): void {
  const { store, opening } = usePalette();
  useEffect(() => {
    const platform = platformOf(navigator);
    const listener = (event: KeyboardEvent) => {
      if (paletteChordOf(event, platform) !== undefined) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // A key held down repeats: a toggle that followed it would close what it had just opened.
        if (!event.repeat) {
          if (store.getSnapshot().open) {
            store.close();
          } else {
            store.open(opening());
          }
        }

        return;
      }

      if (store.getSnapshot().open && blocksUnderModal(event, platform)) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', listener, true);
    return () => {
      window.removeEventListener('keydown', listener, true);
    };
  }, [store, opening]);
}
