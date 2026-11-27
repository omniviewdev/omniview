import type { SessionId } from '../../core/panel';
import type { NoticesStore } from '../../core/notices';
import type { TerminalFinished } from './feed';

// The "command finished" notice (issue #694 step 6): through the shell's notices, for a command that ran long in a terminal the person is not looking at, once for each command, with an action that brings the terminal forward and
// jumps to the command. Decisions are in docs/ui-next/status/T5-notice.md.

/** How long a command runs, by the producer's own times, before a terminal that is not in front says it finished. */
export const LONG_COMMAND_MS = 10_000;

export type FinishedNoticeDeps = {
  readonly notices: Pick<NoticesStore, 'notify'>;
  /** Whether the person is looking at this session's terminal now: it is the one on screen in an open panel, in a window that is shown. */
  readonly shown: (session: SessionId) => boolean;
  /** The notice's action: bring the session's terminal forward, put the keyboard in it and move its view to the command. */
  readonly show: (session: SessionId, command: string) => void;
  /** What the tab is called (`zsh (2)`); a session this does not name is "a terminal". */
  readonly nameOf?: ((session: SessionId) => string | undefined) | undefined;
};

export type FinishedNotices = {
  /** A command finished in a session. */
  readonly finished: (session: SessionId, finished: TerminalFinished) => void;
};

export function createFinishedNotices(_deps: FinishedNoticeDeps): FinishedNotices {
  return {
    finished: () => undefined,
  };
}
