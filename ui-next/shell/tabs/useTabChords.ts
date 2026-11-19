import { useEffect } from 'react';
import { chordOf, platformOf } from '../core/chords';
import type { TabsStore } from '../core/tabs';

/**
 * The tab chords, on the document for as long as the shell is mounted (ch16 S41, S47, S52): Command or Control W closes the tab on screen, 1 to 8 jump to the Nth tab and 9 to the
 * last, and the web alternates (Control Option) do the same where a browser keeps the first for itself. `core/chords.ts` holds the rules. A key something else already took, in a
 * text field or a page, is theirs. A close that would discard unsaved changes answers `confirm`; no page reports a draft yet, so nothing asks. With no tab on screen the close chord has
 * no tab to close and, on a Mac, closes the window instead, when the host can (decision A17: the empty window is not a trap; the Close Window item of the app menu is Command Shift W).
 * Elsewhere it does nothing there: the main window hides when it closes, only macOS has a way to bring it back (the Dock icon), and on Windows and Linux nothing in the app does yet, so the
 * chord must not hide the only window the user has (docs/ui-next/status/S2a.md, Backend catalog).
 */
export function useTabChords(store: TabsStore, onCloseWindow: (() => void) | undefined): void {
  useEffect(() => {
    const platform = platformOf(navigator);
    const listener = (event: KeyboardEvent) => {
      const chord = chordOf(event, platform);
      if (chord === undefined) {
        return;
      }

      event.preventDefault();
      if (chord.action === 'close') {
        if (store.getSnapshot().active !== null) {
          store.close();
        } else if (platform === 'mac') {
          onCloseWindow?.();
        }
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
  }, [store, onCloseWindow]);
}
