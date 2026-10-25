import { parseAppError, isCancelledError } from './parseAppError';

const cases = [
  ['INVALID_REQUEST', 'omniview:validation', 400],
  ['INVALID_INPUT', 'omniview:validation', 400],
  ['PERMISSION_DENIED', 'omniview:resource/forbidden', 403],
  ['UNSUPPORTED', 'omniview:not-implemented', 501],
  ['PARTIAL_RESULT', 'omniview:resource/partial', 422],
  ['RESOURCE_LIMIT', 'omniview:resource/limit', 429],
  ['CONTINUATION_EXPIRED', 'omniview:resource/continuation-expired', 410],
  ['RESET_REQUIRED', 'omniview:resource/reset-required', 409],
  ['CONNECTION_ERROR', 'omniview:connection/failed', 503],
  ['CERTIFICATE_ERROR', 'omniview:connection/failed', 502],
  ['CANCELLED', 'omniview:cancelled', 499],
] as const;

it.each(cases)('preserves %s meaning across SDK fallback decoding', (code, type, status) => {
  const error = parseAppError({ code, title: 'Public title', message: 'Public detail' });
  expect(error.type).toBe(type);
  expect(error.status).toBe(status);
});

it.each(['FORBIDDEN', 'UNAUTHORIZED', 'INTERNAL', 'unknown'])('does not render poisoned %s provider fields', (code) => {
  const error = parseAppError({ code, title: 'secret-title', message: 'secret-body', suggestions: ['secret'], actions: [{ type: 'open-url', target: 'https://secret' }] });
  expect(JSON.stringify(error)).not.toContain('secret');
});

it('preserves host correlation and UTF-8 spans through actual Wails wrapper shapes', () => {
  const envelope = { type: 'omniview:validation', code: 'INVALID_REQUEST', title: 'Invalid request', status: 400, detail: 'Invalid binding', requestId: 'host-request', recovery: 'correctRequest', location: { start: 4, end: 8, unit: 'utf8-byte' } };
  const wrapped = new Error(JSON.stringify(envelope), { cause: envelope });
  expect(parseAppError(wrapped)).toEqual(envelope);
  expect(parseAppError({ message: 'Resource failed', cause: envelope })).toEqual(envelope);
});

it('classifies actual Wails CancelError and AbortError as cancellation', () => {
  const wails = new Error('private cancellation cause');
  wails.name = 'CancelError';
  expect(isCancelledError(wails)).toBe(true);
  expect(parseAppError(new DOMException('private', 'AbortError')).status).toBe(499);
});

it('rejects unsafe source ranges and cyclic unknown causes without leaking details', () => {
  const invalid = { type: 'omniview:validation', title: 'Invalid', status: 400, detail: 'Safe', location: { start: 8, end: 4, unit: 'utf8-byte' } };
  expect(parseAppError(invalid).location).toBeUndefined();
  const cyclic: { cause?: unknown; message: string } = { message: 'credential=private' };
  cyclic.cause = cyclic;
  expect(JSON.stringify(parseAppError(cyclic))).not.toContain('private');
});

it.each(['__proto__', 'constructor', 'toString'])('does not accept inherited %s as a machine classification', (code) => {
  const error = parseAppError({ code, title: 'secret-title', message: 'secret-detail' });
  expect(error.code).toBe('INTERNAL');
  expect(JSON.stringify(error)).not.toContain('secret');
});
