import { useEffect } from 'react';
import { platformOf } from '../core/chords';
import { blocksUnderModal, paletteChordOf } from '../palette/chords';
import { settingsChordOf } from './chords';
import type { SettingsControl } from './host';

/**
 * The Settings chord, on the window for as long as the shell is mounted: Command comma on a Mac and Control comma elsewhere (Control Option comma in a browser) open Settings from anywhere, a text field included, and the key is
 * Settings' alone. While the sheet is open it is a modal, so the window's own chords (close and jump to a tab, toggle the panel) are taken from the page behind it, marked as handled before the listeners that would act on them see
 * them (the palette does the same for itself), and so is the palette's: it would open over the sheet and its commands would go to the page behind. The listener is in the capture phase on the window so it sees the key first, and the shell
 * mounts Settings before the palette so that it is the first on the window. A closed sheet holds this one listener and nothing else.
 */
export function useSettingsChords(control: SettingsControl): void {
  useEffect(() => {
    const platform = platformOf(navigator);
    const listener = (event: KeyboardEvent) => {
      if (settingsChordOf(event, platform) !== undefined) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // A key held down repeats: a second press must not do anything the first did not.
        if (!event.repeat) {
          control.open();
        }

        return;
      }

      if (control.getSnapshot().open && (blocksUnderModal(event, platform) || paletteChordOf(event, platform) !== undefined)) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', listener, true);
    return () => {
      window.removeEventListener('keydown', listener, true);
    };
  }, [control]);
}
