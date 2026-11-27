import { useEffect } from 'react';
import { panelChordOf, platformOf } from '../core/chords';
import type { PanelStore } from '../core/panel';
import { focusTab, inPanel, togglePanel, togglePanelMaximized } from './focus';

/**
 * The panel's chords, on the document for as long as the shell is mounted (ch16 S106, S118): Command or Control J toggles the panel from anywhere, and while the focus is in the panel
 * Close session is Command W on a Mac and Control Shift W elsewhere. `core/chords.ts` holds the rules. The listener is in the capture phase so that it sees the key before the tab chords
 * do: the page's Close tab (Command W) must not also close the page when the user meant the session. With no session on screen the chord is the panel's and does nothing, rather than closing
 * a page the user was not looking at.
 */
export function usePanelChords(store: PanelStore | undefined): void {
  useEffect(() => {
    if (store === undefined) {
      return undefined;
    }

    const platform = platformOf(navigator);
    const listener = (event: KeyboardEvent) => {
      const chord = panelChordOf(event, platform, inPanel(event.target));
      if (chord === undefined) {
        return;
      }

      event.preventDefault();
      if (chord.action === 'maximize') {
        if (!event.repeat) togglePanelMaximized(store);
        return;
      }

      if (chord.action === 'toggle') {
        togglePanel(store);
        return;
      }

      const shown = store.selectors.shown(store.getSnapshot());
      if (shown?.session !== null && shown?.session !== undefined) {
        const closed = store.closeSession(shown.session);
        if (closed.status === 'done') {
          if (closed.active === null) {
            focusTab('panelTools', shown.tool);
          } else {
            focusTab('sessionTabs', closed.active);
          }
        }
      }
    };

    document.addEventListener('keydown', listener, true);
    return () => {
      document.removeEventListener('keydown', listener, true);
    };
  }, [store]);
}
