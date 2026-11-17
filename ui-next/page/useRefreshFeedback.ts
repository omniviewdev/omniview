import type { PageOperation } from '@omniviewdev/kit';
import { useEffect, useRef, useState } from 'react';

/** How long a refresh the user asked for is felt at least, even when the read is instant (slice 1a plan 1.4; the mock's `FELT`). */
export const FELT_MS = 700;

type Phase = 'idle' | 'running' | 'updated';

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
  /** The read. Resolves when it is over and never rejects. */
  readonly refresh: () => Promise<void>;
  /** The source is failed now. Read when the felt time ends, so a failed refresh is not acknowledged as an update. */
  readonly failed: boolean;
};

/**
 * The user's own Refresh, felt (plan 1.4; ch14 P2): the page header's slot says "Refreshing…" from the click until the read is over and at
 * least `FELT_MS` have passed, then "Updated", a calm outcome that the presenter clears by itself. A refresh nobody asked for (the live
 * feed's resynchronisation) is silent: the slot is the acknowledgement of a command, not a log. The same two moments are announced politely.
 */
export function useRefreshFeedback({ title, refresh, failed }: Options): RefreshFeedback {
  const [phase, setPhase] = useState<Phase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(false);
  // Set in the handler itself: two clicks in one frame both see the phase of the last render.
  const asked = useRef(false);
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
    };
  }, []);

  const ask = () => {
    if (asked.current) {
      return;
    }

    asked.current = true;
    setPhase('running');
    const started = Date.now();
    void refresh().then(() => {
      if (!alive.current) {
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
    });
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
        : null;

  return {
    operation,
    announcement: phase === 'running' ? `Refreshing ${title}` : phase === 'updated' ? `${title} refreshed` : '',
    felt: phase === 'running',
    ask,
  };
}
