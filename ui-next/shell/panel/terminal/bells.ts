import type { SessionMarks } from '../host';

// The bells of terminals that are not shown (#697 step 3): a program rang the bell in a session whose body is off screen, and its tab says so until the session is shown. It makes no sound (the host never beeps), and the words are
// what makes the tab's accessible name say it. The marks are an external store the tab strip reads (`SessionMarks`): the same answer until it changes, a notification only for a change.

/** What the tab's name says of a bell. */
export const BELL_WORDS = 'bell rang';

export type BellMarks = SessionMarks & {
  /** A bell rang in a session that is not shown. A second one changes nothing. */
  readonly ring: (session: string) => void;
  /** The session was shown, or closed. */
  readonly clear: (session: string) => void;
  /** How many sessions are marked. */
  readonly size: () => number;
};

const MARK = Object.freeze({ label: BELL_WORDS });

export function createBellMarks(): BellMarks {
  const marked = new Set<string>();
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) {
        listener();
      }
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    of: (session) => (marked.has(session) ? MARK : undefined),
    ring: (session) => {
      if (!marked.has(session)) {
        marked.add(session);
        tell();
      }
    },
    clear: (session) => {
      if (marked.delete(session)) {
        tell();
      }
    },
    size: () => marked.size,
  };
}
