import { useEffect, useRef } from 'react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import type { PageOperation, PageOperationAction, PageOperationState } from './operation';
import styles from './PageOperation.module.css';

/** A calm outcome clears itself this long after it finished (the mock's `LIMIT.inline`). */
export const AUTO_CLEAR_MS = 8000;
/** While the pointer or the focus is in the presenter the clock waits, and looks again after this long (the mock's `LIMIT.grace`). */
export const HELD_GRACE_MS = 2000;

/** Work that is not over: the presenter shows the bar and Cancel. */
const ACTIVE: Readonly<Record<PageOperationState, boolean>> = {
  queued: true,
  running: true,
  paused: true,
  succeeded: false,
  failed: false,
  cancelled: false,
  unknown: false,
};

/** Outcomes that end calmly: they clear themselves. A failure and an unknown outcome stay until they are dismissed. */
const CALM: Readonly<Record<PageOperationState, boolean>> = {
  queued: false,
  running: false,
  paused: false,
  succeeded: true,
  failed: false,
  cancelled: true,
  unknown: false,
};

type Severity = 'info' | 'success' | 'warning' | 'error';

/** An operation's severity follows its state (the mock's `DERIVED`). */
const SEVERITY: Readonly<Record<PageOperationState, Severity>> = {
  queued: 'info',
  running: 'info',
  paused: 'info',
  cancelled: 'info',
  succeeded: 'success',
  failed: 'error',
  unknown: 'warning',
};

/** The word that leads the presenter's accessible name. */
const WORD: Readonly<Record<Severity, string>> = { info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' };

/** Whole percent, 0 to 100. */
const percentOf = (progress: number) => Math.round(Math.min(1, Math.max(0, progress)) * 100);

function Command({ action }: { readonly action: PageOperationAction }) {
  const kind = action.kind;
  return (
    <Button
      variant={kind === 'retry' ? 'primary' : 'secondary'}
      icon={action.icon ?? (kind === 'cancel' ? 'close' : kind === 'retry' ? 'refresh' : undefined)}
      disabledReason={action.disabledReason}
      onClick={() => {
        action.onSelect();
      }}
    >
      {action.label}
    </Button>
  );
}

/**
 * The inline presenter of an operation record, in the page header's slot (the mock's `H.pageOperation` with `H.notification(record,
 * { surface: 'inline', compact: true })`): one 28 px cell holding the step label over a 4 px track and the command column. The track and
 * the command column keep their room through every phase; a finished sentence takes the track's place and draws on up to two lines in the
 * same cell, so nothing around it moves. Props are closed; the record is the caller's.
 */
export function PageOperationView({ operation }: { readonly operation: PageOperation }) {
  const { title, state, text, progress, actions, onDismiss } = operation;
  const active = ACTIVE[state];
  const severity = SEVERITY[state];
  const root = useRef<HTMLElement>(null);
  // The latest dismiss, read when the clock fires: a caller that builds its record in render hands a new function every time, and that must not restart the clock.
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  const clears = CALM[state] && onDismiss !== undefined;

  useEffect(() => {
    if (!clears) {
      return undefined;
    }

    // The clock arms itself and hands back what stops it; a held presenter arms it again for the grace.
    const arm = (delay: number) => {
      const timer = setTimeout(() => {
        // The pointer or the focus is in it: the person is reading it or reaching for a command, so look again later.
        if (root.current?.matches(':hover, :focus-within') === true) {
          stop = arm(HELD_GRACE_MS);
          return;
        }

        dismiss.current?.();
      }, delay);
      return () => {
        clearTimeout(timer);
      };
    };

    let stop = arm(AUTO_CLEAR_MS);
    return () => {
      stop();
    };
  }, [clears]);

  // While the work is active only its cancel command is drawn; once it ended, the record's first command.
  const action = active ? actions?.find((candidate) => candidate.kind === 'cancel') : actions?.[0];
  const bar = active && progress !== undefined;

  return (
    <div className={styles.op}>
      <article
        ref={root}
        className={styles.notify}
        aria-label={`${WORD[severity]}: ${title}`}
        tabIndex={-1}
        data-ov-state={state}
        data-ov-severity={severity}
        data-ov-ended={active ? undefined : 'true'}
      >
        <div className={styles.main}>
          <span className={styles.phase} data-ov-clip="">
            {text}
          </span>
          {bar ? (
            <div className={styles.track} data-ov-track="">
              <div
                className={styles.bar}
                role="progressbar"
                aria-label={title}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress === 'indeterminate' ? undefined : percentOf(progress)}
                aria-valuetext={text}
                data-ov-indeterminate={progress === 'indeterminate' ? 'true' : undefined}
                data-ov-paused={state === 'paused' ? 'true' : undefined}
              >
                <span className={styles.fill} style={{ '--_p': progress === 'indeterminate' ? 100 : percentOf(progress) }} />
              </div>
            </div>
          ) : (
            <div className={styles.track} data-ov-track="" aria-hidden="true" />
          )}
        </div>
        <div className={styles.actions}>
          {action === undefined ? null : <Command action={action} />}
          {active || onDismiss === undefined ? null : (
            <IconButton
              icon="close"
              label={`Dismiss: ${title}`}
              variant="ghost"
              size="row"
              onClick={() => {
                onDismiss();
              }}
            />
          )}
        </div>
      </article>
    </div>
  );
}
