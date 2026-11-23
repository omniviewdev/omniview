import type { StateChange } from '../../core/panel';
import type { TerminalBusy, TerminalFeedCause, TerminalFeedSnapshot } from './feed';

// How a feed's own words become the panel's (ch16 section H, S116's state table; the mock's `sessionWords`, `stripHtml` and `exitSession`). The panel's session has four states and a feed has the same four.
// What the producer knows about how the process ended, and about what runs in it, is optional and read in ONE place each below: a producer that says nothing is the same code path as one that says everything, with
// less to print. The host's own shell says how it ended (its code, its signal, who closed it) and why it could not start (a typed code: no shell could be started), docs/ui-next/status/T2a.md. Pure: the registry
// calls it, the card, the lane and the transcript word it.

const NOT_TOLD = 'The producer gave no reason.';

/**
 * What a start that failed says first, by the code the host typed it with (never by its words): the words after it are the host's own.
 * TODO(host #672: `SHELL_UNAVAILABLE` carries `AppError.tried: [{ source: requested|environment|account|fallback, path, reason: not-found|not-executable|not-a-shell|other, detail? }]` beside the prose detail; once it merges the card lists one path to a line, in words for each token, and the prose stops being shown whole: the next step after T2a).
 */
function startWords(code: string | undefined): string | undefined {
  switch (code) {
    case 'SHELL_UNAVAILABLE':
      return 'No shell could be started';
    case 'SHELL_UNSUPPORTED':
      return 'This program is not a shell Omniview starts';
    case undefined:
    default:
      return undefined;
  }
}

/** The one sentence of a failure the card gives as its reason, in the host's words by where it happened, then the producer's own. */
export function causeSentence(cause: TerminalFeedCause | undefined): string {
  const said = cause?.message.trim() ?? '';
  const message = said === '' ? NOT_TOLD : /[.!?]$/.test(said) ? said : `${said}.`;
  switch (cause?.stage) {
    case 'start': {
      const typed = startWords(cause.code);
      return typed === undefined ? `Couldn't start the terminal. ${message}` : `${typed}. ${message}`;
    }

    case 'input':
      return `Couldn't send what you typed to the terminal. ${message}`;
    case 'session':
    case undefined:
      return `The terminal stopped. ${message}`;
  }
}

/** What the session is when its feed is in this status: the state, and why when it failed. An exit is how a process ended, not a failure: an ended session has no cause. */
export function sessionStateOf(snapshot: TerminalFeedSnapshot): Required<StateChange> {
  return snapshot.state === 'failed' ? { state: 'failed', cause: causeSentence(snapshot.cause) } : { state: snapshot.state, cause: '' };
}

/** How an ended process ended, in words, when its producer told: the code, else the signal, else who closed it. Nothing when it told none of them. */
function endedBy(snapshot: TerminalFeedSnapshot): string {
  const { code, signal, coreDumped, closedBy } = snapshot.exit ?? {};
  if (code !== undefined) {
    return `exited with code ${String(code)}`;
  }

  if (signal !== undefined) {
    return coreDumped === true ? `ended by ${signal} (core dumped)` : `ended by ${signal}`;
  }

  switch (closedBy) {
    case 'request':
      return 'closed';
    case 'window':
      return 'closed with its window';
    case 'shutdown':
      return 'closed when Omniview quit';
    case undefined:
      return '';
  }
}

/** What a session is doing, in the mock's words for a terminal: Connecting, Connected, Ended (S116: Exited with code N when the producer said so), Failed (to start). A session with no feed has ended. */
export function stateWords(snapshot: TerminalFeedSnapshot | undefined): string {
  switch (snapshot?.state) {
    case 'starting':
      return 'Connecting';
    case 'running':
      return 'Connected';
    case 'failed':
      return snapshot.cause?.stage === 'start' ? 'Failed to start' : 'Failed';
    case 'ended':
    case undefined: {
      const how = snapshot === undefined ? '' : endedBy(snapshot);
      return how === '' ? 'Ended' : `${how[0]?.toUpperCase() ?? ''}${how.slice(1)}`;
    }
  }
}

/** What the lane under the screen says: the state, and the one sentence that goes with it. A running terminal says nothing (the mock's strip is empty for a ready session). */
export function laneOf(snapshot: TerminalFeedSnapshot | undefined): { readonly words: string; readonly note: string } {
  switch (snapshot?.state) {
    case 'running':
      return { words: '', note: '' };
    case 'starting':
      return { words: stateWords(snapshot), note: '' };
    case 'failed':
      return { words: stateWords(snapshot), note: causeSentence(snapshot.cause) };
    case 'ended':
      return { words: stateWords(snapshot), note: 'Input is off. Its output stays readable here.' };
    case undefined:
      return { words: stateWords(undefined), note: 'The earlier output is gone.' };
  }
}

/** What was skipped, in words a person reads: whole bytes, thousands, millions. */
function sizeWords(bytes: number): string {
  if (bytes < 1_000) {
    return `${String(bytes)} bytes`;
  }

  return bytes < 1_000_000 ? `${String(Math.round(bytes / 1_000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The last line written into the transcript of a process that ended, muted (S116: `[Process exited with code N]`). Nothing for a session that did not end. */
export function exitLine(snapshot: TerminalFeedSnapshot): string {
  if (snapshot.state !== 'ended') {
    return '';
  }

  const how = endedBy(snapshot);
  return how === '' ? '[Process ended]' : `[Process ${how}]`;
}

/** The line after it, when the host said that a program kept the terminal open after the shell exited: it stopped reading, and dropped what it read after that. Nothing otherwise. */
export function drainLine(snapshot: TerminalFeedSnapshot): string {
  if (snapshot.state !== 'ended' || snapshot.exit?.drainCapped !== true) {
    return '';
  }

  const dropped = snapshot.exit.droppedBytes;
  const base = 'A program kept the terminal open after the shell exited, so the host stopped reading it';
  return dropped === undefined ? `[${base}]` : `[${base} and dropped ${sizeWords(dropped)} of its output]`;
}

/**
 * What a start that failed writes into the transcript, muted, one line each: the typed words (no shell could be started), then the producer's own, which for the host's shell names every path it tried and why.
 * The screen is blank otherwise, and the lane is one line: what the host tried is something to read and to copy. Nothing for a failure that did not happen at the start.
 */
export function failureLines(snapshot: TerminalFeedSnapshot): readonly string[] {
  if (snapshot.state !== 'failed' || snapshot.cause?.stage !== 'start') {
    return [];
  }

  const first = `[${startWords(snapshot.cause.code) ?? 'The terminal could not start'}]`;
  const said = snapshot.cause.message.trim();
  return said === '' ? [first] : [first, `[${said}]`];
}

/** What a close asks a person (S115 and decision L12: a close with a process running asks first; any other close is immediate). */
export type CloseQuestion = { readonly title: string; readonly body: string; readonly confirm: string };

/**
 * The question a close of this session asks, or nothing, given what the producer says runs in it (`busy`, asked when the person closes: the host's `IsBusy`). It asks for a session that RUNS unless the producer says
 * that nothing runs in it but the shell at its prompt (`idle`): the shell itself is a running process, so a producer that cannot say (no answer, or `unknown`) gets the truthful general question. A producer that
 * names the program gets it named. A session that has not started, has ended or has failed has nothing to end.
 */
export function closeQuestionOf(snapshot: TerminalFeedSnapshot | undefined, busy?: TerminalBusy  ): CloseQuestion | undefined {
  if (snapshot?.state !== 'running' || busy?.state === 'idle') {
    return undefined;
  }

  const title = 'Terminate session?';
  const confirm = 'Terminate session';
  if (busy?.state !== 'busy') {
    return { title, body: 'This ends the terminal session. Programs it left running in the background may keep running.', confirm };
  }

  const who = busy.name === undefined || busy.name.trim() === '' ? 'A program' : busy.name.trim();
  return { title, body: `${who} is running in this terminal. This ends the terminal session and stops it.`, confirm };
}
