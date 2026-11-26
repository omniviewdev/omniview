import { parseAppError, type AppError } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, it } from 'vitest';
import { NAME_MAX } from '../connectionName';
import type { ConnectionBusy, ConnectionState, HostConnection } from './types';
import { DETAIL_MAX, detailOf, faceOf, failureOf, labelsOf, nameOf, outcomeOfStatus, refusalOf, safeReason, stateOfReadiness, unhealthyReason, verbFailure, type FailedState } from './words';

// The words of a connection (words.ts): what each state is called, what the host's answers (a readiness word, an `apperror` envelope, a status) come to, and the one line a person may be shown about a failure.
// No runtime and no host: the envelopes are the ones the host sends, and the errors are delivered the way the runtime delivers them.

/** What the host says when a connection needs a sign-in, and when it does not answer (`apperror.AppError` as JSON). */
const UNAUTHORIZED = {
  type: 'omniview:resource/unauthorized',
  title: 'Authentication required',
  status: 401,
  detail: 'The provider requires authentication.',
  code: 'UNAUTHORIZED',
  recovery: 'none',
} as const;
const NOT_RESPONDING = {
  type: 'omniview:connection/failed',
  title: 'Source unavailable',
  status: 503,
  detail: 'The server did not answer.',
  code: 'UNAVAILABLE',
  recovery: 'reconnect',
} as const;

/** An envelope with what a class is read from; the rest is what the host fills in for any error. */
const envelope = (patch: Partial<AppError> = {}): AppError => ({
  type: 'omniview:internal',
  title: 'Operation failed',
  status: 500,
  detail: 'The operation could not be completed.',
  ...patch,
});

/** What a host's envelope may be written as in these tests: a whole `AppError`, or an object with only the fields a case is about. */
type Body = AppError | Readonly<Record<string, unknown>>;

/** What the runtime gives a page when the host's call fails: an object whose `message` is the envelope's JSON and whose `cause` is the envelope itself. */
const delivered = (body: Body): unknown => ({ message: JSON.stringify(body), cause: body, kind: 'RuntimeError' });

/** The same, as the `Error` Wails makes of it. */
const wails = (body: Body): Error => Object.assign(new Error(JSON.stringify(body)), { cause: body });

/** What a person is told when the host gave no line that is safe to show. */
const FALLBACKS: Readonly<Record<FailedState, string>> = {
  unauthorized: 'The connection needs you to sign in.',
  forbidden: 'You do not have access to this connection.',
  certificate: 'The certificate of the server could not be verified.',
  unreachable: 'The server did not answer.',
  failed: 'The connection did not start.',
};

/** Every way an envelope can say what class a failure is, and what class that is. The checks run in order: sign-in, then access, then a certificate, then a server that does not answer. */
const CLASSES: Array<[name: string, state: FailedState, patch: Partial<AppError>]> = [
  ['a 401', 'unauthorized', { status: 401 }],
  ['the code UNAUTHORIZED', 'unauthorized', { code: 'UNAUTHORIZED' }],
  ['the type of an unauthorized resource', 'unauthorized', { type: 'omniview:resource/unauthorized' }],
  ['a 403', 'forbidden', { status: 403 }],
  ['the code FORBIDDEN', 'forbidden', { code: 'FORBIDDEN' }],
  ['the type of a forbidden resource', 'forbidden', { type: 'omniview:resource/forbidden' }],
  ['the code CERTIFICATE_ERROR, on the envelope the host sends for it (a failed connection, a 502, reconnect)', 'certificate', { code: 'CERTIFICATE_ERROR', type: 'omniview:connection/failed', status: 502, recovery: 'reconnect' }],
  ['a recovery of reconnect', 'unreachable', { recovery: 'reconnect' }],
  ['the type of a failed connection', 'unreachable', { type: 'omniview:connection/failed' }],
  ['the type of a timeout', 'unreachable', { type: 'omniview:resource/timeout' }],
  ['a 502', 'unreachable', { status: 502 }],
  ['a 503', 'unreachable', { status: 503 }],
  ['a 504', 'unreachable', { status: 504 }],
  ['a 500', 'failed', {}],
  ['a 501', 'failed', { status: 501 }],
  ['a 505', 'failed', { status: 505 }],
  ['a 404', 'failed', { status: 404, code: 'NOT_FOUND', type: 'omniview:resource/not-found' }],
  ['a 408 that no type calls a timeout', 'failed', { status: 408 }],
  ['a 400 the caller must correct', 'failed', { status: 400, recovery: 'correctRequest' }],
  ['a cancellation', 'failed', { type: 'omniview:cancelled', status: 499, code: 'CANCELLED', recovery: 'none' }],
  ['a 401 that also says reconnect', 'unauthorized', { status: 401, recovery: 'reconnect' }],
  ['a 403 that also says reconnect', 'forbidden', { status: 403, recovery: 'reconnect' }],
  ['a 503 whose code is FORBIDDEN', 'forbidden', { status: 503, code: 'FORBIDDEN' }],
];

describe('faceOf', () => {
  it.each([
    ['connected', 'healthy', 'Connected'],
    ['connecting', 'progress', 'Connecting…'],
    ['disconnected', 'stopped', 'Disconnected'],
    ['unauthorized', 'attention', 'Needs sign-in'],
    ['forbidden', 'error', 'Access denied'],
    ['certificate', 'error', 'Certificate problem'],
    ['unreachable', 'error', 'Not responding'],
    ['failed', 'error', 'Connection failed'],
  ] as const)('says %s with the role %s and the word "%s"', (state, role, word) => {
    expect(faceOf(state)).toEqual({ role, word });
  });

  it('has one word for each state, so that no two states are told apart by their glyph alone', () => {
    const everyState: Readonly<Record<ConnectionState, true>> = { connected: true, connecting: true, disconnected: true, unauthorized: true, forbidden: true, certificate: true, unreachable: true, failed: true };
    const states = Object.keys(everyState) as ConnectionState[];

    const words = states.map((state) => faceOf(state).word);

    expect(new Set(words).size).toBe(states.length);
    expect(words.every((word) => word.trim() !== '')).toBe(true);
  });
});

describe('safeReason', () => {
  it('shows a plain sentence as it is', () => {
    expect(safeReason('The server did not answer in time.', 'fallback')).toBe('The server did not answer in time.');
  });

  it('shows it trimmed', () => {
    expect(safeReason('  The token has expired.\t', 'fallback')).toBe('The token has expired.');
  });

  it('does not take the line break at the end of a line for a second line', () => {
    expect(safeReason('The token has expired.\n', 'fallback')).toBe('The token has expired.');
  });

  it.each([
    ['no text', undefined],
    ['an empty text', ''],
    ['a blank text', ' \t \n '],
  ])('is the fallback for %s', (_name, text) => {
    expect(safeReason(text, 'fallback')).toBe('fallback');
  });

  it.each([
    ['a line break', 'first line\nsecond line'],
    ['a carriage return', 'first line\rsecond line'],
    ['a Windows line break', 'first line\r\nsecond line'],
    ['a line separator', 'first line\u2028second line'],
    ['a stack frame', 'Error: refused at start (/srv/plugin/main.js:10:5)'],
    ['a stack frame that is all there is', 'at x (file:1:2)'],
    ['the word goroutine', 'panic in goroutine 7 while connecting'],
    ['an object', '{"error":"refused"}'],
    ['an array', '[{"error":"refused"}]'],
  ])('is the fallback for a text with %s', (_name, text) => {
    expect(safeReason(text, 'fallback')).toBe('fallback');
  });

  it('shows 200 characters and no more', () => {
    expect(safeReason('x'.repeat(200), 'fallback')).toBe('x'.repeat(200));
    expect(safeReason('x'.repeat(201), 'fallback')).toBe('fallback');
  });

  it('counts the characters that are shown, not the blanks around them', () => {
    expect(safeReason(`   ${'x'.repeat(200)}   `, 'fallback')).toBe('x'.repeat(200));
  });

  it('shows a sentence that only mentions a bracket, a brace or the word at', () => {
    expect(safeReason('Could not reach [the server] at the address you gave {it}.', 'fallback')).toBe('Could not reach [the server] at the address you gave {it}.');
  });

  it('is the fallback for what is not text at all, which a host that sends a field of another shape would give', () => {
    expect(safeReason(42 as unknown as string, 'fallback')).toBe('fallback');
  });
});

describe('nameOf', () => {
  it('is the name a person gave the connection', () => {
    expect(nameOf({ name: 'Production' })).toBe('Production');
  });

  it('is the name trimmed', () => {
    expect(nameOf({ name: '  Production \n' })).toBe('Production');
  });

  it.each([
    ['none', {}],
    ['undefined', { name: undefined }],
    ['empty', { name: '' }],
    ['blank', { name: '   ' }],
  ])('is "Unnamed connection" when the name is %s', (_name, connection) => {
    expect(nameOf(connection)).toBe('Unnamed connection');
  });

  it('is never the connection\'s id: an id is the plugin\'s and is not for reading', () => {
    const connection = { id: 'a1b2c3-secret-id', name: undefined };

    expect(nameOf(connection)).toBe('Unnamed connection');
  });

  // N2 of the review of HM3b: the host's own list is one of the two places a name comes in (the other is a page's lane, `connectionName.test.ts`), and Home's rows, the picker's options and the palette's rows all draw what this says.
  it('is clipped to NAME_MAX characters, the cut said by an ellipsis, so that a name of a million characters never reaches a row, an option or a heading', () => {
    expect(nameOf({ name: 'n'.repeat(1_000_000) })).toBe(`${'n'.repeat(NAME_MAX - 1)}…`);
    expect(nameOf({ name: `  ${'n'.repeat(NAME_MAX + 1)}  ` })).toHaveLength(NAME_MAX);
  });

  it('keeps a name whole that a person could have given a connection: up to NAME_MAX characters, a hundred and ten among them', () => {
    for (const length of [1, 24, 25, 110, NAME_MAX]) {
      const name = `a${'b'.repeat(length - 1)}`;
      expect(nameOf({ name }), String(length)).toBe(name);
    }
  });
});

describe('detailOf', () => {
  it('is the plugin\'s secondary text, as the plugin gave it', () => {
    expect(detailOf({ description: 'EKS \u00b7 us-east-1' })).toBe('EKS \u00b7 us-east-1');
  });

  it('is one line: the whitespace between the words is one space and the ends are trimmed', () => {
    expect(detailOf({ description: '  EKS \n\t us-east-1  \r\n' })).toBe('EKS us-east-1');
  });

  it.each([
    ['none', {}],
    ['undefined', { description: undefined }],
    ['empty', { description: '' }],
    ['blank', { description: ' \n\t ' }],
    ['not text', { description: 42 as unknown as string }],
  ])('is undefined when the description is %s: the row has no second line', (_name, connection) => {
    expect(detailOf(connection)).toBeUndefined();
  });

  it('is cut at DETAIL_MAX characters, the cut said by an ellipsis, so that a long text a person wrote never grows the row', () => {
    const text = detailOf({ description: 'w'.repeat(DETAIL_MAX + 50) });

    expect(text).toHaveLength(DETAIL_MAX);
    expect(text?.endsWith('\u2026')).toBe(true);
  });

  it('keeps a text of exactly DETAIL_MAX characters whole', () => {
    expect(detailOf({ description: 'w'.repeat(DETAIL_MAX) })).toBe('w'.repeat(DETAIL_MAX));
  });
});

describe('stateOfReadiness', () => {
  it.each([
    ['CONNECTED', 'connected'],
    ['PENDING', 'connecting'],
    ['DISCONNECTED', 'disconnected'],
    ['UNKNOWN', 'disconnected'],
    ['', 'disconnected'],
    ['SOMETHING_THE_HOST_ADDS_LATER', 'disconnected'],
  ] as const)('%s is %s, with no reason', (readiness, state) => {
    expect(stateOfReadiness(readiness)).toEqual({ state, reason: undefined });
  });

  it('is failed, with no reason, for a FAILED readiness the host gave no error for', () => {
    expect(stateOfReadiness('FAILED')).toEqual({ state: 'failed', reason: undefined });
  });

  it.each(CLASSES)('is the class of the host\'s error for a FAILED readiness: %s is %s', (_name, state, patch) => {
    expect(stateOfReadiness('FAILED', envelope(patch)).state).toBe(state);
  });

  it('says the host\'s line when it is safe to show and the class\'s sentence when it is not', () => {
    const plain = stateOfReadiness('FAILED', envelope({ status: 403, detail: 'The role may not list the projects.' }));
    const unsafe = stateOfReadiness('FAILED', envelope({ status: 403, detail: 'denied\n  at check (/srv/auth.js:1:2)' }));

    expect(plain).toEqual({ state: 'forbidden', reason: 'The role may not list the projects.' });
    expect(unsafe).toEqual({ state: 'forbidden', reason: FALLBACKS.forbidden });
  });

  it.each(['CONNECTED', 'PENDING', 'DISCONNECTED', 'UNKNOWN', 'ANYTHING'])('does not read the error of a %s readiness', (readiness) => {
    const withError = stateOfReadiness(readiness, envelope(UNAUTHORIZED));
    const without = stateOfReadiness(readiness);

    expect(withError).toEqual(without);
    expect(withError.reason).toBeUndefined();
  });
});

describe('failureOf', () => {
  it.each(CLASSES)('classes an envelope with %s as %s', (_name, state, patch) => {
    expect(failureOf(delivered(envelope(patch))).state).toBe(state);
  });

  it.each(CLASSES)('says the class\'s sentence for %s when the host\'s own line is not one to show', (_name, state, patch) => {
    expect(failureOf(delivered(envelope({ ...patch, detail: 'first line\nsecond line' }))).reason).toBe(FALLBACKS[state]);
  });

  it.each(CLASSES)('says the host\'s line for %s when it is one to show', (_name, _state, patch) => {
    expect(failureOf(delivered(envelope({ ...patch, detail: 'The host said this in one line.' }))).reason).toBe('The host said this in one line.');
  });

  describe.each([
    ['the object the runtime delivers (message, cause and kind)', delivered],
    ['the Error Wails makes of it', wails],
    ['the envelope itself', (body: Body) => body],
    ['the text of a Go error that carries it after its operation', (body: Body) => `start connection: ${JSON.stringify(body)}`],
  ])('an envelope as %s', (_name, deliver) => {
    it('is a sign-in, with the host\'s line, for the host\'s UNAUTHORIZED envelope', () => {
      expect(failureOf(deliver(UNAUTHORIZED))).toEqual({ state: 'unauthorized', reason: 'The provider requires authentication.' });
    });

    it('is a server that does not answer, with the host\'s line, for the host\'s UNAVAILABLE envelope', () => {
      expect(failureOf(deliver({ ...NOT_RESPONDING, detail: 'The host refused the connection.' }))).toEqual({ state: 'unreachable', reason: 'The host refused the connection.' });
      expect(failureOf(deliver(NOT_RESPONDING))).toEqual({ state: 'unreachable', reason: 'The server did not answer.' });
    });
  });

  it('shows no text the plugin wrote when the error is not the host\'s envelope: it is failed, with the runtime\'s own sentence', () => {
    const raw = new Error('boom: token=abc123 at /Users/me/.omniview/plugins/acme/main.js:3:4');

    const failure = failureOf(raw);

    expect(failure).toEqual({ state: 'failed', reason: parseAppError(raw).detail });
    expect(failure.reason).not.toMatch(/boom|token|abc123|Users/);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a plain text', 'the plugin said no'],
    ['an object that is no envelope', { message: 'refused', code: 7 }],
  ])('is failed, with the runtime\'s own sentence, for %s', (_name, error) => {
    const failure = failureOf(error);

    expect(failure).toEqual({ state: 'failed', reason: parseAppError(error).detail });
    expect(failure.reason).not.toBe('');
    expect(failure.reason).not.toMatch(/plugin said no|refused/);
  });

  it('counts a cancellation as a failure: whether it is shown is for the caller to decide', () => {
    const failure = failureOf('cancelled');

    expect(failure).toEqual({ state: 'failed', reason: parseAppError('cancelled').detail });
    expect(failure.reason).not.toBe('');
  });
});

describe('outcomeOfStatus', () => {
  it('is connected for CONNECTED, whatever else the status says', () => {
    expect(outcomeOfStatus({ status: 'CONNECTED' })).toEqual({ status: 'connected' });
    expect(outcomeOfStatus({ status: 'CONNECTED', error: 'a stale error', details: 'stale details' })).toEqual({ status: 'connected' });
  });

  it.each([
    ['UNAUTHORIZED', 'unauthorized'],
    ['FORBIDDEN', 'forbidden'],
  ] as const)('is %s for a status that says so, with the class\'s sentence when the status has no line', (status, state) => {
    expect(outcomeOfStatus({ status })).toEqual({ status: 'failed', state, reason: FALLBACKS[state] });
  });

  it.each(['NOT_FOUND', 'ERROR', 'FAILED', 'PENDING', 'DISCONNECTED', 'UNKNOWN', 'TIMEOUT', 'UNAVAILABLE', 'BAD_REQUEST', '', 'SOMETHING_THE_HOST_ADDS_LATER'])('is a failure that did not start for %s', (status) => {
    expect(outcomeOfStatus({ status })).toEqual({ status: 'failed', state: 'failed', reason: FALLBACKS.failed });
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN', 'FAILED'])('says the error of a %s status when it is one to show', (status) => {
    const outcome = outcomeOfStatus({ status, error: 'The token has expired.', details: 'Details of it.' });

    expect(outcome).toMatchObject({ status: 'failed', reason: 'The token has expired.' });
  });

  it('says the details when the status has no error', () => {
    expect(outcomeOfStatus({ status: 'FAILED', error: '', details: 'The server is starting.' })).toMatchObject({ reason: 'The server is starting.' });
    expect(outcomeOfStatus({ status: 'FAILED', details: 'The server is starting.' })).toMatchObject({ reason: 'The server is starting.' });
  });

  it('says the sentence of the class, not the details, when the error is not one to show', () => {
    const outcome = outcomeOfStatus({ status: 'FAILED', error: '{"code":14,"message":"unavailable"}', details: 'The server is starting.' });

    expect(outcome).toEqual({ status: 'failed', state: 'failed', reason: FALLBACKS.failed });
  });

  it('says the sentence of the class when neither the error nor the details is one to show', () => {
    expect(outcomeOfStatus({ status: 'FORBIDDEN', error: 'denied\nat check (/srv/auth.js:1:2)', details: 'x'.repeat(201) })).toEqual({ status: 'failed', state: 'forbidden', reason: FALLBACKS.forbidden });
  });
});

describe('unhealthyReason', () => {
  it.each([
    ['CONNECTED', {}, undefined],
    ['UNAUTHORIZED', {}, FALLBACKS.unauthorized],
    ['FORBIDDEN', { error: 'The role may not connect.' }, 'The role may not connect.'],
    ['DISCONNECTED', { error: 'ignored' }, 'The connection is not connected.'],
    ['PENDING', {}, 'The connection is still connecting.'],
    ['NOT_FOUND', { details: 'The context is gone.' }, 'The context is gone.'],
    ['SOMETHING_THE_HOST_ADDS_LATER', { error: 'first line\nsecond line' }, 'The connection is not healthy.'],
  ])('says what a check that answered %s %j means for the connection: %s', (status, text, reason) => {
    expect(unhealthyReason({ status, ...text })).toBe(reason);
  });
});

describe('verbFailure', () => {
  it('says the host\'s line when it is one to show, and the verb\'s own sentence when it is not', () => {
    expect(verbFailure(wails(envelope({ detail: 'The profile is read only.' })), 'The connection was not removed.')).toBe('The profile is read only.');
    expect(verbFailure(wails(envelope({ detail: 'first line\nsecond line' })), 'The connection was not removed.')).toBe('The connection was not removed.');
  });
});

describe('labelsOf', () => {
  it('is the labels whose value is text, in the order the host gave them, and nothing for a backend that put none: the host\'s JSON says null for it', () => {
    expect(labelsOf({ labels: { env: 'prod', 'team/name': 'core', replicas: 3, on: true, nested: { a: 'b' }, empty: '' } })).toEqual({ env: 'prod', 'team/name': 'core', empty: '' });
    expect(Object.keys(labelsOf({ labels: { b: '1', a: '2' } }) ?? {})).toEqual(['b', 'a']);
    for (const none of [null, undefined, {}, { replicas: 3 }, ['text'], 'text']) {
      expect(labelsOf({ labels: none }), JSON.stringify(none)).toBeUndefined();
    }
  });
});

describe('refusalOf', () => {
  const north = (over: Partial<HostConnection>): HostConnection => ({ plugin: 'acme', key: 'n', name: 'north', state: 'connected', reason: undefined, ...over });

  it.each([
    ['connecting', 'north is connecting. Try again when it has finished.'],
    ['checking', 'north is being checked. Try again when it has finished.'],
    ['disconnecting', 'north is disconnecting. Try again when it has finished.'],
    ['removing', 'north is being removed. Try again when it has finished.'],
  ] satisfies ReadonlyArray<readonly [ConnectionBusy, string]>)('names the connection and what is being done to it: %s', (busy, sentence) => {
    expect(refusalOf(north({ busy }))).toBe(sentence);
  });

  it('refuses a connection that the host says is connecting although this window is doing nothing to it, and no other state', () => {
    expect(refusalOf(north({ state: 'connecting' }))).toBe('north is connecting. Try again when it has finished.');
    for (const state of ['connected', 'disconnected', 'unauthorized', 'forbidden', 'certificate', 'unreachable', 'failed'] satisfies ConnectionState[]) {
      expect(refusalOf(north({ state })), state).toBeUndefined();
    }
  });
});
