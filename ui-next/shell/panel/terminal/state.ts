import type { StateChange } from '../../core/panel';
import type { TerminalFeedCause, TerminalFeedSnapshot } from './feed';

// How a feed's own words become the panel's (ch16 section H, S116's state table; the mock's `sessionWords`, `stripHtml` and `exitSession`). The panel's session has four states and a feed has the same four.
// What the producer knows about how the process ended, and about what runs in it, is optional in the snapshot and read in ONE place each below: a producer that says nothing is the same code path as one that says
// everything, with less to print. Pure: the registry calls it, the card, the lane and the transcript word it.

const NOT_TOLD = 'The producer gave no reason.';

/** The one sentence of a failure the card gives as its reason, in the host's words by where it happened, then the producer's own. */
export function causeSentence(cause: TerminalFeedCause | undefined): string {
  const said = cause?.message.trim() ?? '';
  const message = said === '' ? NOT_TOLD : /[.!?]$/.test(said) ? said : `${said}.`;
  switch (cause?.stage) {
    case 'start':
      return `Couldn't start the terminal. ${message}`;
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

/** How an ended process ended, in words, when its producer told: the code, else the signal. Nothing when it told neither. */
function endedBy(snapshot: TerminalFeedSnapshot): string {
  const { code, signal } = snapshot.exit ?? {};
  if (code !== undefined) {
    return `exited with code ${String(code)}`;
  }

  return signal === undefined ? '' : `ended by ${signal}`;
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

/** The last line written into the transcript of a process that ended, muted (S116: `[Process exited with code N]`). Nothing for a session that did not end. */
export function exitLine(snapshot: TerminalFeedSnapshot): string {
  if (snapshot.state !== 'ended') {
    return '';
  }

  const how = endedBy(snapshot);
  return how === '' ? '[Process ended]' : `[Process ${how}]`;
}

/** What a close asks a person (S115 and decision L12: a close with a process running asks first; any other close is immediate). */
export type CloseQuestion = { readonly title: string; readonly body: string; readonly confirm: string };

/**
 * The question a close of this session asks, or nothing. It asks for a session that RUNS unless its producer says that nothing runs in it but the shell at its prompt (`foreground: false`): the shell itself
 * is a running process, so until the producer can say what runs the truthful question is the general one. A producer that names the program gets it named. A session that has not started, has ended or has
 * failed has nothing to end.
 */
export function closeQuestionOf(snapshot: TerminalFeedSnapshot | undefined): CloseQuestion | undefined {
  if (snapshot?.state !== 'running' || snapshot.foreground === false) {
    return undefined;
  }

  const { foreground } = snapshot;
  const title = 'Terminate session?';
  const confirm = 'Terminate session';
  if (foreground === undefined) {
    return { title, body: 'This ends the terminal session. Programs it left running in the background may keep running.', confirm };
  }

  const who = foreground.name === undefined || foreground.name.trim() === '' ? 'A program' : foreground.name.trim();
  return { title, body: `${who} is running in this terminal. This ends the terminal session and stops it.`, confirm };
}
