import type { LogFeedCause, LogFeedSnapshot } from '@omniviewdev/kit';
import type { StateChange } from '../../core/panel';

// How a feed's own words become the panel's (ch16 section H; the mock's `sessionWords`). The panel's session has four states and a feed has five: `starting` and `streaming` are the session's
// `starting` and `running`; `paused` is the READER's pause (the feed holds the lines, the backend goes on), so it is a running session and a fact of its card, not a state of the work;
// `ended` and `failed` are final. Pure: the registry calls it, the card words it.

/** The one sentence of a failure the card gives as its reason, in the words the view's own notice uses (packages/kit/src/log/words.ts `failureWords`): what stopped, then the source's cause. */
export function causeSentence(cause: LogFeedCause | undefined): string {
  const said = cause?.message.trim() ?? '';
  const message = said === '' ? 'The source gave no reason.' : /[.!?]$/.test(said) ? said : `${said}.`;
  return `${cause?.stage === 'create' ? 'Couldn\'t start the log stream' : 'The log stream stopped'}. ${message}`;
}

/** What the session is when its feed is in this status: the state, and why when it failed. A pause changes nothing here. */
export function sessionStateOf(snapshot: LogFeedSnapshot): Required<StateChange> {
  switch (snapshot.state) {
    case 'starting':
      return { state: 'starting', cause: '' };
    case 'streaming':
    case 'paused':
      return { state: 'running', cause: '' };
    case 'ended':
      return { state: 'ended', cause: '' };
    case 'failed':
      return { state: 'failed', cause: causeSentence(snapshot.cause) };
  }
}

/** What a session of this state is doing, in the mock's words for a log: Connecting, Streaming, Stream ended, Failed (to start, when the creation itself failed). */
export function stateWords(state: StateChange['state'], cause: LogFeedCause | undefined): string {
  switch (state) {
    case 'starting':
      return 'Connecting';
    case 'running':
      return 'Streaming';
    case 'ended':
      return 'Stream ended';
    case 'failed':
      return cause?.stage === 'create' ? 'Failed to start' : 'Failed';
  }
}
