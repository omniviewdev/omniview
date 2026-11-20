import { useState, useSyncExternalStore } from 'react';
import { usePalette } from './context';
import styles from './Palette.module.css';

/**
 * Where the model tells a person what the list came to (ch16 S86): a polite status that is part of the dialog (a modal makes the rest of the window inert, and a region outside it would not be
 * heard). The sentence is told once, when the results have been still, and a refusal as it is worded. A text that was told before this region existed is not repeated to someone who has only
 * just opened the palette, and a sentence told twice in a row is two announcements: the node is replaced, not rewritten.
 */
export function LiveRegion() {
  const { announcer } = usePalette();
  const [first] = useState(() => announcer.getSnapshot().serial);
  const { text, serial } = useSyncExternalStore(announcer.subscribe, announcer.getSnapshot);
  return (
    <div className={styles.hidden} role="status" aria-live="polite" aria-atomic="true" data-palette-part="live">
      <span key={serial}>{serial > first ? text : ''}</span>
    </div>
  );
}
