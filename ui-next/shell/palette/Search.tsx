import { Icon, KeyHint, tip } from '@omniviewdev/kit';
import { useState } from 'react';
import { platformOf } from '../core/chords';
import { usePalette } from './context';
import styles from './Search.module.css';
import { chordKeys, chordText } from './words';

/**
 * The top row's Search control (ch16 S6, the Window actions: Search `⌘K`): a 20 px glyph and the chord, 30 px high, which opens the palette. It is a button and a Tab stop (decision A14), named
 * Search, with its chord as `aria-keyshortcuts` and in its tip. Its accessible name is the label and the chord it draws ("Search ⌘K"): a name that holds the text the control shows is one a voice
 * user can say (WCAG 2.5.3). It takes the focus when it is pressed: Safari does not focus a button it was clicked on, and the palette gives the focus back to the element that had it when it
 * opened, so the control must be that element.
 */
export function Search() {
  const { store, opening } = usePalette();
  const [platform] = useState(() => platformOf(navigator));
  const chord = chordText('Mod+K', platform);
  return (
    <button
      type="button"
      className={styles.search}
      aria-label={`Search ${chord}`}
      aria-haspopup="dialog"
      aria-keyshortcuts={chordKeys('Mod+K', platform)}
      data-shell-part="search"
      {...tip(`Search\n${chord}`)}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        if (!store.getSnapshot().open) {
          store.open(opening());
        }
      }}
    >
      <Icon name="search" size={20} />
      <KeyHint keys={chord} />
    </button>
  );
}
