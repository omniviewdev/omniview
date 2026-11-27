import type { SessionId } from '../../core/panel';
import type { NoticesStore } from '../../core/notices';
import type { TerminalFinished } from './feed';
import { durationWords } from './gutter/words';

// The "command finished" notice (issue #694 step 6): through the shell's notices, for a command that ran long in a terminal the person is not looking at, once for each command, with an action that brings the terminal forward and
// jumps to the command. Decisions are in docs/ui-next/status/T5-notice.md.
//
//   - long is the PRODUCER's duration (`durationMs`, the host's clock at the shell's marks): a command with no duration is not long, and no clock of the page is read;
//   - not in front is the caller's to say (`shown`): the terminal is the one on screen in an open panel of a window that is shown;
//   - once for each command: a command is told by its session, its id and its end time (a restarted shell counts from `c1` again, at another time), and what was told is bounded;
//   - what the notice says of a command is the person's own text: control characters are dropped, the words are bounded (title 80, detail 120), and the shell's notices draw them as text.

/** How long a command runs, by the producer's own times, before a terminal that is not in front says it finished. */
export const LONG_COMMAND_MS = 10_000;

/** How many commands the notices remember having told, oldest let go first. */
const TOLD = 256;

const TITLE_MAX = 80;
const DETAIL_MAX = 120;
const NAME_MAX = 40;
const SEPARATOR = ' · ';

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

// eslint-disable-next-line no-control-regex -- a command line is the person's text: the control characters are what is dropped
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;

/** Text for a line of a notice: no control character, one space between words, at most `max` characters (the last is an ellipsis when it was cut). */
function line(text: string, max: number): string {
  const plain = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) {
    return plain;
  }

  return `${plain.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function createFinishedNotices(deps: FinishedNoticeDeps): FinishedNotices {
  const told = new Set<string>();

  const remember = (key: string): void => {
    told.add(key);
    if (told.size > TOLD) {
      const [oldest] = told;
      if (oldest !== undefined) {
        told.delete(oldest);
      }
    }
  };

  return {
    finished: (session, finished) => {
      const { durationMs } = finished;
      if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < LONG_COMMAND_MS) {
        return;
      }

      const key = `${session}\u0000${finished.id}\u0000${String(finished.timeMs ?? '')}`;
      if (told.has(key) || deps.shown(session)) {
        return;
      }

      remember(key);
      const name = line(deps.nameOf?.(session) ?? '', NAME_MAX);
      const where = name === '' ? 'a terminal' : name;
      const failed = finished.exit !== undefined && finished.exit !== 0;
      const rest = [...(failed ? [`exit ${String(finished.exit)}`] : []), `took ${durationWords(durationMs)}`];
      const tail = `${SEPARATOR}${rest.join(SEPARATOR)}`;
      const command = finished.command === undefined ? '' : line(finished.command, DETAIL_MAX - tail.length);
      deps.notices.notify({
        title: line(`${failed ? 'Command failed' : 'Command finished'} in ${where}`, TITLE_MAX),
        detail: command === '' ? rest.join(SEPARATOR) : `${command}${tail}`,
        severity: failed ? 'warning' : 'success',
        initiator: 'system',
        actions: [
          {
            id: 'show',
            kind: 'custom',
            label: 'Show',
            primary: true,
            run: () => {
              deps.show(session, finished.id);
            },
          },
        ],
      });
    },
  };
}
