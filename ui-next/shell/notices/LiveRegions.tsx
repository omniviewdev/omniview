import { useState, useSyncExternalStore } from 'react';
import type { Announcer } from '../palette/host';
import { useNotices } from './context';
import styles from './Toasts.module.css';

// The window's two live regions (ch16 S86, `#shell-live`): where a record that has no toast is told to a screen reader, once at its start and once at its finish (the model decides what, and which of the two). They
// are always there and always empty until something is told: a live region that appears with its text is not reliably announced. A sentence told twice in a row is two announcements, so the node is replaced and not
// rewritten, and what was told before this window existed is not told to someone who has only just opened it (the palette's own region does the same).
//
// They carry `aria-live` and no role: a page that has a `status` or an `alert` of its own (a failed page, a refresh that finished) is found by that role, and an empty region of this window's must not be taken for it.

function Told({ source, live, part }: { readonly source: Announcer; readonly live: 'polite' | 'assertive'; readonly part: string }) {
  const [first] = useState(() => source.getSnapshot().serial);
  const { text, serial } = useSyncExternalStore(source.subscribe, source.getSnapshot);
  return (
    <div className={styles.hidden} aria-live={live} aria-atomic="true" data-notices-part={part}>
      <span key={serial}>{serial > first ? text : ''}</span>
    </div>
  );
}

export function LiveRegions() {
  const { announcer } = useNotices();
  return (
    <>
      <Told source={announcer.polite} live="polite" part="live" />
      <Told source={announcer.assertive} live="assertive" part="alert" />
    </>
  );
}
