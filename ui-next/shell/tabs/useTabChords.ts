import { useEffect } from 'react';
import { chordOf, platformOf } from '../core/chords';
import type { TabsStore } from '../core/tabs';

/**
 * The tab chords, on the document for as long as the shell is mounted (ch16 S41, S47, S52): Command or Control W closes the tab on screen, 1 to 8 jump to the Nth tab and 9 to the
 * last, and the web alternates (Control Option) do the same where a browser keeps the first for itself. `core/chords.ts` holds the rules. A key something else already took, in a
 * text field or a page, is theirs. A close that would discard unsaved changes answers `confirm`; no page reports a draft yet, so nothing asks.
 */
export function useTabChords(store: TabsStore): void {
  useEffect(() => {
    const platform = platformOf(navigator);
    const listener = (event: KeyboardEvent) => {
      const chord = chordOf(event, platform);
      if (chord === undefined) {
        return;
      }

      event.preventDefault();
      if (chord.action === 'close') {
        store.close();
      } else if (chord.action === 'jump') {
        store.goto(chord.n);
      } else {
        store.last();
      }
    };

    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, [store]);
}
