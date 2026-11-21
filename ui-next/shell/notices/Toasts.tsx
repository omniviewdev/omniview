import { useRef, useSyncExternalStore } from 'react';
import { useNotices } from './context';
import { LiveRegions } from './LiveRegions';
import { Toast } from './Toast';
import styles from './Toasts.module.css';
import { usePlacement } from './usePlacement';
import { useStack } from './useStack';

/**
 * The toast layer of a window (ch16 S76 to S79, O6; the mock's `#feedback` and `.notify-host`): the stack the model composed (at most three, the summary toast on top when records do not fit, newest at the bottom), drawn
 * at the bottom right above the status bar, and the window's two live regions. It draws the snapshot and nothing else: which records get a toast, for how long, and what a screen reader is told of one that has none are the
 * model's (../core/notices).
 *
 * The layer is the one live region of the stack and is always there, empty or not (S86: `aria-live="polite"`, `aria-atomic="false"`; a toast inserted into it is announced). Its landmark, "Notifications", exists only while
 * there is a toast, and then it is an F6 stop whose focus is the first toast (S12, S13); a toast never takes the focus on its own. While a modal owns the window the model gives no toast (S89a) and the layer draws none.
 * Closed, it holds one layer, two empty regions and the handlers React delegates, and no timer.
 *
 * The layer is home and stays there. The stack inside it, the landmark, is the one that is placed (./placement.ts, ./usePlacement.ts; P7: a toast never covers a control): `data-place` is `moved` while it stands in
 * a box of its own (`--_x`, `--_y` and `--_w`, physical pixels from the window's top left corner), or `yield` while it has no room anywhere, when it is hidden and inert and is not a stop of F6. Home has no `data-place`.
 */
export function Toasts() {
  const { store, announcer } = useNotices();
  const { items } = useSyncExternalStore(store.subscribe, store.selectors.toasts);
  const layer = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const events = useStack(layer, store, items.length);
  const place = usePlacement(layer, host, items, announcer.announce, store, events.giveBack);
  const moved = place.mode === 'moved' ? place : undefined;
  return (
    <>
      <div ref={layer} className={styles.layer} data-notices-part="layer" aria-live="polite" aria-atomic="false" onPointerOver={events.onPointerOver} onPointerOut={events.onPointerOut} onFocus={events.onFocus} onBlur={events.onBlur}>
        {items.length === 0 ? null : (
          <div
            ref={host}
            className={styles.host}
            role="region"
            aria-label="Notifications"
            data-notices-part="host"
            data-shell-region={place.mode === 'yield' ? undefined : 'toasts'}
            data-place={place.mode === 'default' ? undefined : place.mode}
            inert={place.mode === 'yield'}
            style={{ '--_x': moved === undefined ? undefined : `${String(moved.x)}px`, '--_y': moved === undefined ? undefined : `${String(moved.y)}px`, '--_w': moved === undefined ? undefined : `${String(moved.w)}px` }}
          >
            {items.map((item, index) => (
              <Toast key={item.key} item={item} first={index === 0} />
            ))}
          </div>
        )}
      </div>
      <LiveRegions />
    </>
  );
}
