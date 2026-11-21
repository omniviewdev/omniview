import { createLogViewControls, LogView, type LogFeed, type LogTimestamps } from '@omniviewdev/kit';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { copyToClipboard } from './clipboard';
import { LogToolbar } from './LogToolbar';
import { announcementOf, logToolsOf, slotsFor, type LogAnnouncement, type LogToolId } from './toolbar';
import styles from './LogsBody.module.css';

type LogSessionProps = {
  /** The session's name ("orders-api/app · north"): the accessible name of the log. */
  readonly label: string;
  readonly feed: LogFeed;
  /** The session's id: the view says it in `data-log-session`, for what finds a view by it. */
  readonly session: string;
};

/** How long the Copy button confirms itself: the mock's two seconds (shell-panel.js 1449). */
const CONFIRM_MS = 2000;

/**
 * One Logs session's body inside the box the panel gives it: the toolbar (a 40 px column) and the kit's log view beside it, and the session's own choices, which are React state of this component: the clock
 * the rows show, and the confirmation of a copy. Follow and Pause are not state of the toolbar: the view and its stream hold them (the toolbar reads them through the view's controls), so the strip, the
 * keys of the list and the toolbar always say the same thing. The host mounts it once per session and keeps it for as long as the session lives, so what the session chose survives another tool being shown and
 * another session being chosen; it is not saved, and a restored session starts as a new one (nothing of a stream is saved either). It lives inside the body's `Activity`: while the body is not on screen its
 * effects are released, so the toolbar holds no subscription and no timer.
 */
export function LogSession({ label, feed, session }: LogSessionProps) {
  const [controls] = useState(createLogViewControls);
  const state = useSyncExternalStore(controls.subscribe, controls.getSnapshot);
  // How many buttons the column holds, from its height (the body's): every button until it is measured, and while it cannot be (a body that is not laid out is 0 px high).
  const column = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const element = column.current;
    if (element === null) {
      return undefined;
    }

    const measure = () => {
      if (element.clientHeight > 0) {
        setSlots(slotsFor(element.clientHeight));
      }
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  // A change of how many buttons the column holds can remove the button that has the focus (the panel grew and the More button went, or it shrank and the button went behind More), and a browser then gives the focus
  // to the body, so the arrows stop reaching the toolbar. The button the reader was on is remembered with its place; when it is gone and the focus is nowhere, the button at that place takes it (the one that took the
  // More button's slot, or the More button for a button that went behind it). A focus the reader put somewhere else is left where it is.
  const lastFocus = useRef<{ readonly element: HTMLElement; readonly place: number } | null>(null);
  useLayoutEffect(() => {
    const had = lastFocus.current;
    const bar = column.current?.querySelector('[role=toolbar]');
    if (had === null || bar === null || bar === undefined || had.element.isConnected || (document.activeElement !== null && document.activeElement !== document.body)) {
      return;
    }

    const buttons = bar.querySelectorAll('button');
    const next = buttons[Math.min(had.place, buttons.length - 1)];
    if (next instanceof HTMLElement) {
      next.focus();
    }
  }, [slots]);
  const [timestamps, setTimestamps] = useState<LogTimestamps>('local');
  const [copied, setCopied] = useState(false);
  // How many copies succeeded: each one starts the confirmation's two seconds again, also when the last has not run out.
  const [copies, setCopies] = useState(0);
  // What a person who cannot see the toolbar is told. Each is a new message, so a copy of the same lines twice is announced twice.
  const [announcement, setAnnouncement] = useState<{ readonly id: number; readonly text: string } | undefined>(undefined);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setCopied(false);
    }, CONFIRM_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied, copies]);

  const say = (what: LogAnnouncement) => {
    setAnnouncement((last) => ({ id: (last?.id ?? 0) + 1, text: announcementOf(what) }));
  };

  // A toggle flips what the view and the stream are when it is pressed, which is what the controls' snapshot says: the state this component drew with may be a press behind (a second press before React draws again).
  const press = (tool: LogToolId) => {
    switch (tool) {
      case 'follow':
        controls.follow(!controls.getSnapshot().following);
        break;
      case 'pause':
        controls.pause(!controls.getSnapshot().paused);
        break;
      case 'timestamps':
        setTimestamps((now) => (now === 'utc' ? 'local' : 'utc'));
        break;
      case 'clear':
        controls.clear();
        break;
      case 'copy': {
        const lines = controls.copy(timestamps);
        if (lines !== undefined) {
          void copyToClipboard(lines.text).then((done) => {
            if (done) {
              setCopied(true);
              setCopies((count) => count + 1);
              say({ kind: 'copied', lines: lines.lines });
            } else {
              say({ kind: 'copy-failed' });
            }
          });
        }

        break;
      }
    }
  };

  return (
    <>
      <div
        ref={column}
        className={styles.tools}
        data-shell-part="logsTools"
        onFocus={(event) => {
          // React types the target as the column, but it is whichever element took the focus.
          const target = event.target;
          const bar = event.currentTarget.querySelector('[role=toolbar]');
          const buttons: readonly Element[] = bar === null ? [] : [...bar.querySelectorAll('button')];
          const place = buttons.indexOf(target);
          lastFocus.current = place < 0 ? null : { element: target, place };
        }}
        onBlur={(event) => {
          // A press elsewhere or a Tab out is the reader's own move. A button that was taken out of the page may or may not send a blur, and is not connected when it does.
          if (event.target instanceof Node && event.target.isConnected) {
            lastFocus.current = null;
          }
        }}
      >
        <LogToolbar tools={logToolsOf({ state, timestamps, copied })} slots={slots} onPress={press} />
      </div>
      <div className={styles.view}>
        <LogView label={label} feed={feed} controls={controls} timestamps={timestamps} data-log-session={session} />
      </div>
      {/* Always in the body, empty at rest: a live region that appears together with its text is not announced. */}
      <span className={styles.live} role="status">
        {announcement === undefined ? null : <span key={announcement.id}>{announcement.text}</span>}
      </span>
    </>
  );
}
