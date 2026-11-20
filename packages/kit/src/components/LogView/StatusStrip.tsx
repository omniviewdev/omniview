import { useSyncExternalStore } from 'react';
import type { LogViewModel } from '../../log/logViewModel';
import { droppedNote, statText } from '../../log/statText';
import type { LogFeedState } from '../../log/types';
import { Button } from '../Button';
import styles from './LogView.module.css';

type StatusStripProps = {
  readonly model: LogViewModel;
  readonly state: LogFeedState;
  /** The feed's own pause flag, "whatever `state` says": a feed paused while it starts is `starting` and paused. */
  readonly paused: boolean;
  readonly following: boolean;
  /** Lets the feed's lines through again. */
  readonly onResume: () => void;
  /** Back to the live end of the log; the caller moves the focus to the list. */
  readonly onJumpToLatest: () => void;
};

/** What the strip says of a log that is over: the mock's words. */
const OVER: Partial<Record<LogFeedState, string>> = { ended: 'Stream ended', failed: 'Session failed' };

/**
 * The status strip (the mock's `.ptool__status`, S116): a fixed 28 px lane that says what the session is doing: how many lines, how fast, whether the list
 * follows, what was dropped (one total: the lines the view evicted and the ones the feed never gave it; what it is made of is the tooltip and the accessible description), and the one way back to the live end, which is drawn only while the list is not there (scrolled back, or paused), so it never
 * covers a line. Its numbers come from their own subscription, told at most four times a second and only when one changed, so a stream does not render it
 * once per frame.
 */
export function StatusStrip({ model, state, paused: flagged, following, onResume, onJumpToLatest }: StatusStripProps) {
  const stats = useSyncExternalStore(model.subscribeStats, model.getStats);
  const over = OVER[state];
  // A log that is over has no pause to lift (the view lifts it); any other is paused when the feed says so, in whatever state it is, and a paused log is a live one.
  const paused = over === undefined && (flagged || state === 'paused');
  const live = state === 'streaming' || paused;
  const note = droppedNote(stats);
  return (
    <div className={styles.strip} role="group" aria-label="Session status">
      {over === undefined ? null : <span className={styles.state}>{over}</span>}
      <span className={styles.stat} aria-live="off" aria-description={note} data-ov-tip={note}>
        {statText({ ...stats, live, paused, following })}
      </span>
      {paused ? (
        <span className={styles.actions}>
          <Button size="row" icon="play" onClick={onResume}>
            Resume
          </Button>
        </span>
      ) : live && !following ? (
        <span className={styles.actions}>
          <Button size="row" icon="arrow-down-to-line" onClick={onJumpToLatest}>
            Jump to latest
          </Button>
        </span>
      ) : null}
    </div>
  );
}
