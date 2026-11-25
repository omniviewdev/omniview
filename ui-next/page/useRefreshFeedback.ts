import type { PageOperation } from '@omniviewdev/kit';
import { useEffect, useRef, useState } from 'react';

/** How long a refresh the user asked for is felt at least, even when the read is instant (slice 1a plan 1.4; the mock's `FELT`). */
export const FELT_MS = 700;

/**
 * How long a refresh the user asked for is waited for. A read that has not answered by then is given up on: the header says `Refresh did not finish`, with a Retry, and the command is available again (S3 of the review of HM3b). Thirty seconds is as long as the host
 * waits for a plugin's bundle to load, longer than any read of a healthy plugin takes (a slow remote API answers in seconds), and short enough that a person who pressed Refresh once is not left at an unavailable button for a minute, which they cannot cancel.
 */
export const REFRESH_LIMIT_MS = 30_000;

type Phase = 'idle' | 'running' | 'updated' | 'failed';

export type RefreshFeedback = {
  /** The page header's operation slot: `null` at rest (the slot stays, empty, so nothing moves when it fills), else the record to present. */
  readonly operation: PageOperation | null;
  /** The polite announcement of both ends of a felt refresh, for a live region that is always in the page. Empty at rest. */
  readonly announcement: string;
  /** The user's Refresh was asked and has not been acknowledged yet. */
  readonly felt: boolean;
  /** The user asks for a refresh. Ignored while one is felt: one read, one acknowledgement. */
  ask(): void;
};

type Options = {
  /** The plural name of what is listed: "Items". It names the operation and words the announcement. */
  readonly title: string;
  /**
   * The read. It resolves when it is over and never rejects (the contract of `DetailSource.refresh` and `ListSource.refresh`), but a plugin's may reject, throw, or never answer: one that does, or has not answered in `REFRESH_LIMIT_MS`, is a refresh
   * that did not finish.
   */
  readonly refresh: () => Promise<void>;
  /** The source is failed now. Read when the felt time ends, so a failed refresh is not acknowledged as an update. */
  readonly failed: boolean;
};

/**
 * The user's own Refresh, felt (plan 1.4; ch14 P2): the page header's slot says "Refreshing…" from the click until the read is over and at
 * least `FELT_MS` have passed, then "Updated", a calm outcome that the presenter clears by itself. A refresh nobody asked for (the live
 * feed's resynchronisation) is silent: the slot is the acknowledgement of a command, not a log. The same two moments are announced politely.
 *
 * A read that rejects or throws, or that has not answered in `REFRESH_LIMIT_MS`, is said too (S3): the slot says "Refresh did not finish", a failure that stays until it is dismissed, with a Retry that asks again, and the command is available again.
 * The words are the page's own and the plugin's go to the log. The list page and the detail page, and so an overview, draw this one hook, so they all say it. A read that is given up on and answers later changes nothing: what was said stays said.
 */
export function useRefreshFeedback({ title, refresh, failed }: Options): RefreshFeedback {
  const [phase, setPhase] = useState<Phase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The wait for the read, which `REFRESH_LIMIT_MS` bounds.
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(false);
  // Set in the handler itself: two clicks in one frame both see the phase of the last render.
  const asked = useRef(false);
  // The ask whose read is waited for, by number: each ask is over once, by its answer, its failure or the limit, and what comes after that is a late answer, which is nobody's.
  const run = useRef(0);
  // The latest `failed`, read when the clock fires: the source may have failed after the click.
  const failedNow = useRef(failed);

  useEffect(() => {
    failedNow.current = failed;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      clearTimeout(limit.current);
    };
  }, []);

  const ask = () => {
    if (asked.current) {
      return;
    }

    asked.current = true;
    run.current += 1;
    const mine = run.current;
    setPhase('running');
    const started = Date.now();
    // Ends the wait for this ask's read, and says whether it was still the one that was waited for, in a page that is still there.
    const over = (): boolean => {
      if (run.current !== mine) {
        return false;
      }

      run.current += 1;
      clearTimeout(limit.current);
      return alive.current;
    };

    const didNotFinish = (said: string, detail?: unknown): void => {
      if (over()) {
        console.error(`[page] the refresh of ${title} ${said}`, ...(detail === undefined ? [] : [detail]));
        asked.current = false;
        setPhase('failed');
      }
    };

    limit.current = setTimeout(() => {
      didNotFinish(`did not answer in ${String(REFRESH_LIMIT_MS / 1000)} s`);
    }, REFRESH_LIMIT_MS);
    let read: Promise<void>;
    try {
      read = Promise.resolve(refresh());
    } catch (error) {
      didNotFinish('threw', error);
      return;
    }

    void read.then(
      () => {
        if (!over()) {
          return;
        }

        timer.current = setTimeout(
          () => {
            timer.current = undefined;
            asked.current = false;
            setPhase(failedNow.current ? 'idle' : 'updated');
          },
          Math.max(0, FELT_MS - (Date.now() - started)),
        );
      },
      (error: unknown) => {
        didNotFinish('was rejected', error);
      },
    );
  };

  const operation: PageOperation | null =
    phase === 'running'
      ? { title: `Refresh ${title}`, state: 'running', text: 'Refreshing…', progress: 'indeterminate' }
      : phase === 'updated'
        ? {
          title: `Refresh ${title}`,
          state: 'succeeded',
          text: 'Updated',
          onDismiss: () => {
            setPhase('idle');
          },
        }
        : phase === 'failed'
          ? {
            title: `Refresh ${title}`,
            state: 'failed',
            text: 'Refresh did not finish',
            actions: [{ id: 'retry', label: 'Retry', kind: 'retry', onSelect: ask }],
            onDismiss: () => {
              setPhase('idle');
            },
          }
          : null;

  return {
    operation,
    announcement: phase === 'running' ? `Refreshing ${title}` : phase === 'updated' ? `${title} refreshed` : phase === 'failed' ? `${title} did not refresh` : '',
    felt: phase === 'running',
    ask,
  };
}
