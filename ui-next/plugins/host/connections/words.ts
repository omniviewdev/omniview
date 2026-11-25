import { ErrorTypes, parseAppError, type AppError } from '@omniviewdev/runtime/ui/v1';
import { nameText } from '../connectionName';
import type { ConnectOutcome, ConnectionState, StateFace } from './types';

// The words of a connection (HM1): what each state is called, which of the host's answers is which state, and the one line a person may be shown about a failure. The host says what happened in its own
// vocabulary (a readiness word, an `apperror` envelope, a status code) and a plugin adds text of its own; this is the one place that turns both into what the window draws. Framework-free, like `published.ts`.
//
// The class of a failure is read from the host's envelope (`parseAppError`, the runtime's one parser: decision R13) and never from the text a plugin wrote. The text is shown only when it is one plain
// sentence (`safeReason`): anything that looks like a stack, a payload or a page of output gives way to a sentence of the host's own.

/** The states a start can fail into: what the person can do about it (sign in, ask for access, wait for the server), or nothing in particular (`failed`). */
export type FailedState = Extract<ConnectOutcome, { readonly status: 'failed' }>['state'];

/** A failure as the window says it: its class and one line that is safe to show. */
export type Failure = { readonly state: FailedState; readonly reason: string };

/** What the host's readiness says of a connection: the state and, for a failure the host classified, its line. */
export type Readiness = { readonly state: ConnectionState; readonly reason: string | undefined };

/** The word and the role of each state, one word for each state so that two states are never told apart by a glyph alone. The words are the design mock's. */
const FACES: Readonly<Record<ConnectionState, StateFace>> = {
  connected: { role: 'healthy', word: 'Connected' },
  connecting: { role: 'progress', word: 'Connecting…' },
  disconnected: { role: 'stopped', word: 'Disconnected' },
  unauthorized: { role: 'attention', word: 'Needs sign-in' },
  forbidden: { role: 'error', word: 'Access denied' },
  unreachable: { role: 'error', word: 'Not responding' },
  failed: { role: 'error', word: 'Connection failed' },
};

/** What a person is told when the host gave no line that is safe to show, by the class of the failure. */
const REASONS: Readonly<Record<FailedState, string>> = {
  unauthorized: 'The connection needs you to sign in.',
  forbidden: 'You do not have access to this connection.',
  unreachable: 'The server did not answer.',
  failed: 'The connection did not start.',
};

/** What a connection is called when its plugin gave it no name. Never its key: a key is the plugin's id for it and is not for reading. */
const UNNAMED = 'Unnamed connection';

/** The longest line shown as the reason of a failure. */
const REASON_LIMIT = 200;

/**
 * A line break (a text that has one is a page of output, not a line), the word a Go crash dump starts with, or a stack frame like `at start (file.js:10:5)`. The same rules as the runtime's
 * `safeMessage` (`connectionReadiness.ts`, which is not exported), with the Unicode line separators counted as line breaks.
 */
const NOT_A_LINE = /[\r\n\u2028\u2029]|\bgoroutine\b|\bat\s+\S+\s+\(.*:\d+:\d+\)/;

/** The word and the role a state is drawn with. */
export function faceOf(state: ConnectionState): StateFace {
  return FACES[state];
}

/**
 * The one line a person may be shown about a failure: `text` trimmed, when it is a single plain line of at most 200 characters; else `fallback`. A text with a line break, a stack frame, the word `goroutine`,
 * one that starts like a payload (`{` or `[`), a blank one and one that is longer is never shown.
 */
export function safeReason(text: string | undefined, fallback: string): string {
  const line = typeof text === 'string' ? text.trim() : '';
  if (line === '' || line.length > REASON_LIMIT || line.startsWith('{') || line.startsWith('[') || NOT_A_LINE.test(line)) {
    return fallback;
  }

  return line;
}

/**
 * The class of a failure by what the host's envelope says (the checks run in this order, so a 401 that also says `reconnect` is a sign-in, not a server that is silent): a 401, the code UNAUTHORIZED or its type is
 * `unauthorized`; a 403, the code FORBIDDEN or its type is `forbidden`; the host says to reconnect, the type says the connection failed or timed out, or the status is a 502, 503 or 504, `unreachable`; anything else `failed`.
 */
function classOf(error: AppError): FailedState {
  if (error.status === 401 || error.code === 'UNAUTHORIZED' || error.type === ErrorTypes.RESOURCE_UNAUTHORIZED) {
    return 'unauthorized';
  }

  if (error.status === 403 || error.code === 'FORBIDDEN' || error.type === ErrorTypes.RESOURCE_FORBIDDEN) {
    return 'forbidden';
  }

  if (
    error.recovery === 'reconnect' ||
    error.type === ErrorTypes.CONNECTION_FAILED ||
    error.type === ErrorTypes.RESOURCE_TIMEOUT ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504
  ) {
    return 'unreachable';
  }

  return 'failed';
}

/** The class of an envelope and the line to show with it: its detail when that is safe, else the class's own sentence. */
function describe(error: AppError): Failure {
  const state = classOf(error);
  return { state, reason: safeReason(error.detail, REASONS[state]) };
}

/**
 * What a start that threw came to, from what it threw (the host's envelope as the runtime delivers it, or anything else). A cancellation is a failure here too: whether it is shown is for the caller to decide.
 * What is not the host's envelope has no class and none of its text: it is `failed`, with the runtime's own sentence.
 */
export function failureOf(error: unknown): Failure {
  return describe(parseAppError(error));
}

/**
 * What the host's readiness word says of a connection (`GetAllConnectionStates`): CONNECTED is connected, PENDING is connecting, FAILED is a failure, by the class of its `error` when the host gave one, and
 * DISCONNECTED, UNKNOWN and any word this does not know are disconnected. The error is read only for a FAILED readiness.
 */
export function stateOfReadiness(readiness: string, error?: AppError): Readiness {
  switch (readiness) {
    case 'CONNECTED':
      return { state: 'connected', reason: undefined };
    case 'PENDING':
      return { state: 'connecting', reason: undefined };
    case 'FAILED':
      return error === undefined ? { state: 'failed', reason: undefined } : describe(error);
    default:
      return { state: 'disconnected', reason: undefined };
  }
}

/** A start that ended without throwing, as the failure it is: `reason` is the line to show, else the class's sentence. */
function failedWith(state: FailedState, text: string | undefined): ConnectOutcome {
  return { status: 'failed', state, reason: safeReason(text, REASONS[state]) };
}

/**
 * What a status that a start RETURNED (it did not throw) means: CONNECTED is connected, UNAUTHORIZED and FORBIDDEN are those classes, and every other word (NOT_FOUND, ERROR, FAILED, PENDING, DISCONNECTED,
 * UNKNOWN, one this does not know) is a failure that did not start. The line is the status's error, or its details when it has no error, when it is safe to show.
 */
export function outcomeOfStatus(status: { readonly status: string; readonly error?: string | undefined; readonly details?: string | undefined }): ConnectOutcome {
  const text = status.error !== undefined && status.error !== '' ? status.error : status.details;
  switch (status.status) {
    case 'CONNECTED':
      return { status: 'connected' };
    case 'UNAUTHORIZED':
      return failedWith('unauthorized', text);
    case 'FORBIDDEN':
      return failedWith('forbidden', text);
    default:
      return failedWith('failed', text);
  }
}

/**
 * What a person reads for a connection: its name trimmed and clipped to `NAME_MAX` (`connectionName.ts`: the host's list is one of the places a name comes in, so Home's rows, the picker's options and the palette's rows never draw a longer one), else
 * `Unnamed connection`. Never its key.
 */
export function nameOf(connection: { readonly name?: string | undefined }): string {
  return nameText(connection.name) ?? UNNAMED;
}

/** The longest secondary text Home and the picker draw: the line is clipped and its tip says the rest, and a plugin's text is only a description a person may have written. */
export const DETAIL_MAX = 200;

/** The plugin's secondary text for a connection (the SDK connection's `description`) as one line: whitespace collapsed, at most `DETAIL_MAX` characters; undefined when there is none. */
export function detailOf(connection: { readonly description?: string | undefined }): string | undefined {
  const text = typeof connection.description === 'string' ? connection.description.replace(/\s+/g, ' ').trim() : '';
  return text === '' ? undefined : text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}
