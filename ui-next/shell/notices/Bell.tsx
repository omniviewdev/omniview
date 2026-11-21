import { Icon, tip } from '@omniviewdev/kit';
import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Centre } from './centreControl';
import { CentrePopover } from './Centre';
import { placeAbove, type Place } from './centreDom';
import { useNotices } from './context';
import styles from './Bell.module.css';

// The bell of the status bar (ch16 S81, S90; the mock's built-in bell and `bellFace`, shell-regions.js and shell-feedback.js): a 24 px target with a 16 px glyph, last in the bar, which opens the notification centre. A
// 6 px dot says there is something unread, in the colour of the worst of it (`--ov-error-fg`, `--ov-warning-fg`, else the accent), and never a number (A12): what is unread is in the name and in the tooltip, in words
// ("Notifications, 3 unread, 1 error"), which the model makes once (`Bell.label`). The popover it opens is drawn only while it is open, so a closed bell is one button and holds nothing.

export function Bell({ centre }: { readonly centre: Centre }) {
  const { store } = useNotices();
  const bell = useSyncExternalStore(store.subscribe, store.selectors.bell);
  const { open } = useSyncExternalStore(centre.subscribe, centre.getSnapshot);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<Place | null>(null);

  // Where the popover stands is measured against the bell as it opens, before anything is painted, and the popover is drawn once it is known: the rows are drawn in one commit, never in a place that is then moved.
  useLayoutEffect(() => {
    setPlace(open && button.current !== null ? placeAbove(button.current) : null);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={styles.bell}
        aria-label={bell.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-notices-part="bell"
        {...tip(bell.label)}
        onClick={centre.toggle}
      >
        <span className={styles.glyph} data-notices-part="bellGlyph" aria-hidden="true">
          <Icon name="bell" />
          {bell.dot === '' ? null : <i className={styles.dot} data-notices-part="bellDot" data-tone={bell.dot} />}
        </span>
      </button>
      {open && place !== null ? <CentrePopover id={id} place={place} centre={centre} invoker={button} /> : null}
    </>
  );
}
