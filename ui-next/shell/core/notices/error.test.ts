import { describe, expect, it } from 'vitest';
import { noticeFromHostError } from './error';

// The host's error as a notice (docs/ui-next/status/E0-1.md, decision R13: one parser, one describer; the parser is the runtime's `parseAppError`, and this takes what it answers). The title is
// the class's (a short noun phrase the host owns), the detail is the sentence: the plugin's own when it wrote one (E0-1, B-02), else the host's class sentence. FORBIDDEN and UNAUTHORIZED
// keep the host's text whatever a caller or a plugin would put in their place (the host's rule C02, K14: no arbitrary remote text in chrome); so do INTERNAL and PROVIDER_ERROR, which the
// host also words itself. A cancellation is never a notice. The eight envelopes below are the ones E0-1 recorded, line for line.

const envelope = (extra: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify({ requestId: '5b8c2f6e-7a43-4e0a-9d1f-0c7a1d2e3f40', recovery: 'none', ...extra })) as Record<string, unknown>;

const OLD = {
  NOT_FOUND: '{"type":"omniview:resource/not-found","title":"Not found","status":404,"detail":"The requested resource was not found.","code":"NOT_FOUND","requestId":"<uuid>","recovery":"none"}',
  FORBIDDEN: '{"type":"omniview:resource/forbidden","title":"Access denied","status":403,"detail":"The operation is not permitted.","code":"FORBIDDEN","requestId":"<uuid>","recovery":"none"}',
  CONFLICT: '{"type":"omniview:resource/conflict","title":"Conflict","status":409,"detail":"The operation conflicts with current state.","code":"CONFLICT","requestId":"<uuid>","recovery":"refreshContract"}',
  TIMEOUT: '{"type":"omniview:resource/timeout","title":"Timed out","status":408,"detail":"The operation exceeded its deadline.","code":"TIMEOUT","requestId":"<uuid>","recovery":"none"}',
};

const NEW = {
  NOT_FOUND: '{"type":"omniview:resource/not-found","title":"Not found","status":404,"detail":"The requested resource or API group was not found.","code":"NOT_FOUND","requestId":"<uuid>","recovery":"none"}',
  FORBIDDEN: OLD.FORBIDDEN,
  CONFLICT: '{"type":"omniview:resource/conflict","title":"Conflict","status":409,"detail":"The resource operation conflicts with the current cluster state.","code":"CONFLICT","requestId":"<uuid>","recovery":"refreshContract"}',
  TIMEOUT: '{"type":"omniview:resource/timeout","title":"Timed out","status":408,"detail":"The cluster did not complete the request in time.","code":"TIMEOUT","requestId":"<uuid>","recovery":"none"}',
};

const read = (text: string): unknown => JSON.parse(text);

describe('the eight envelopes of E0-1, as the TypeScript side receives them', () => {
  it('gives the class\'s title and the plugin\'s sentence (a rebuilt plugin)', () => {
    expect(noticeFromHostError(read(NEW.NOT_FOUND))).toMatchObject({ severity: 'error', title: 'Not found', detail: 'The requested resource or API group was not found.' });
    expect(noticeFromHostError(read(NEW.CONFLICT))).toMatchObject({ title: 'Conflict', detail: 'The resource operation conflicts with the current cluster state.' });
    expect(noticeFromHostError(read(NEW.TIMEOUT))).toMatchObject({ title: 'Timed out', detail: 'The cluster did not complete the request in time.' });
  });

  it('gives the host\'s own class sentence for a plugin that did not send one (a plugin built before E0-1)', () => {
    expect(noticeFromHostError(read(OLD.NOT_FOUND))).toMatchObject({ title: 'Not found', detail: 'The requested resource was not found.' });
    expect(noticeFromHostError(read(OLD.CONFLICT))).toMatchObject({ title: 'Conflict', detail: 'The operation conflicts with current state.' });
    expect(noticeFromHostError(read(OLD.TIMEOUT))).toMatchObject({ title: 'Timed out', detail: 'The operation exceeded its deadline.' });
  });

  it('keeps the host\'s text for FORBIDDEN, whatever is offered in its place', () => {
    const own = noticeFromHostError(read(NEW.FORBIDDEN));
    expect(own).toMatchObject({ title: 'Access denied', detail: 'The operation is not permitted.' });
    const offered = noticeFromHostError(read(NEW.FORBIDDEN), { title: 'Couldn\'t scale cart-api', detail: 'The token cart-api-ro was refused by 10.0.0.12.' });
    expect(offered).toMatchObject({ title: 'Access denied', detail: 'The operation is not permitted.' });
    expect(JSON.stringify(offered)).not.toContain('10.0.0.12');
  });

  it('keeps the host\'s text for UNAUTHORIZED, INTERNAL and PROVIDER_ERROR too', () => {
    const classes: ReadonlyArray<readonly [string, string, string, number]> = [
      ['UNAUTHORIZED', 'omniview:resource/unauthorized', 'Authentication required', 401],
      ['INTERNAL', 'omniview:internal', 'Operation failed', 500],
      ['PROVIDER_ERROR', 'omniview:resource/provider-error', 'Operation failed', 502],
    ];
    for (const [code, type, title, status] of classes) {
      const made = noticeFromHostError(envelope({ type, title, status, detail: 'The operation could not be completed.', code }), { title: 'Mine', detail: 'My own sentence, with a secret.' });
      expect({ code, title: made?.title, detail: made?.detail }).toEqual({ code, title, detail: 'The operation could not be completed.' });
    }
  });

  it('knows the class from the type when the code is absent', () => {
    const made = noticeFromHostError(envelope({ type: 'omniview:resource/forbidden', title: 'Access denied', status: 403, detail: 'The operation is not permitted.' }), { detail: 'Mine' });
    expect(made?.detail).toBe('The operation is not permitted.');
  });
});

describe('what a caller may say in its own words', () => {
  it('names what failed in the user\'s terms and gives its own sentence, for a class whose text is the plugin\'s', () => {
    const made = noticeFromHostError(read(NEW.TIMEOUT), { title: 'Couldn\'t scale cart-api', detail: 'Cart-api did not answer in 30 seconds.' });
    expect(made).toMatchObject({ title: 'Couldn\'t scale cart-api', detail: 'Cart-api did not answer in 30 seconds.' });
  });

  it('is of work the user started unless it says otherwise, and carries the way forward and the dedupe', () => {
    const retry = { id: 'retry', kind: 'retry' as const };
    const made = noticeFromHostError(read(NEW.TIMEOUT), { actions: [retry], key: 'scale:cart-api', group: 'scale', target: 'cart-api', origin: { anchor: 'scale-button' } });
    expect(made).toMatchObject({ initiator: 'user', actions: [retry], key: 'scale:cart-api', group: 'scale', target: 'cart-api', origin: { anchor: 'scale-button' } });
    expect(noticeFromHostError(read(NEW.TIMEOUT), { initiator: 'system' })?.initiator).toBe('system');
  });
});

describe('a cancellation is never a notice', () => {
  it('says nothing for the cancelled class', () => {
    expect(noticeFromHostError(envelope({ type: 'omniview:cancelled', title: 'Cancelled', status: 499, detail: 'The operation was cancelled.', code: 'CANCELLED' }))).toBeUndefined();
    expect(noticeFromHostError(envelope({ type: 'omniview:cancelled', title: 'Cancelled', status: 499, detail: 'The operation was cancelled.' }))).toBeUndefined();
  });
});

describe('severity', () => {
  it('is an error, and a warning for a partial result: what came is still useful', () => {
    expect(noticeFromHostError(read(NEW.TIMEOUT))?.severity).toBe('error');
    expect(noticeFromHostError(envelope({ type: 'omniview:resource/partial', title: 'Partial result', status: 422, detail: 'Two of five sources did not answer.', code: 'PARTIAL_RESULT' }))?.severity).toBe('warning');
  });
});

describe('diagnostics, behind a disclosure', () => {
  it('carry the code and the request, for a person who has to ask for help', () => {
    const made = noticeFromHostError(read(NEW.TIMEOUT));
    expect(made?.details).toContain('Code: TIMEOUT');
    expect(made?.details).toContain('Request: <uuid>');
  });

  it('carry the whole sentence when the notice\'s own line had to cut it, and the suggestions the host gave', () => {
    const long = `${'The cluster did not answer. '.repeat(20)}End.`;
    const made = noticeFromHostError(envelope({ type: 'omniview:resource/timeout', title: 'Timed out', status: 408, detail: long, code: 'TIMEOUT', suggestions: ['Check the network.', 'Try a smaller request.'] }));
    expect(made?.details).toContain(long);
    expect(made?.details).toContain('• Check the network.');
    expect(made?.details).toContain('• Try a smaller request.');
  });

  it('are left out when there is nothing to add', () => {
    const made = noticeFromHostError(envelope({ type: 'omniview:resource/timeout', title: 'Timed out', status: 408, detail: 'Short.', requestId: undefined }));
    expect(made?.details).toBeUndefined();
  });

  it('read at most eight suggestions', () => {
    const suggestions = Array.from({ length: 20 }, (_, index) => `Suggestion ${String(index)}`);
    const made = noticeFromHostError(envelope({ type: 'omniview:resource/timeout', title: 'Timed out', status: 408, detail: 'x', suggestions }));
    expect((made?.details ?? '').split('\n').filter((line) => line.startsWith('•'))).toHaveLength(8);
  });
});

describe('an error that is not the host\'s envelope', () => {
  it('is a generic failure that shows none of what it said: raw text is never chrome', () => {
    const inputs: unknown[] = [undefined, null, 'boom: token=abc123', 42, { message: 'secret token abc123' }, new Error('secret token abc123'), [], {}];
    for (const input of inputs) {
      const made = noticeFromHostError(input);
      expect(made).toMatchObject({ severity: 'error', title: 'Operation failed', detail: 'The operation could not be completed.' });
      expect(JSON.stringify(made)).not.toContain('abc123');
    }
  });

  it('is incomplete when a member the host always sends is missing or wrong', () => {
    for (const broken of [{ title: 'T', status: 500, detail: 'd' }, { type: 'omniview:internal', status: 500, detail: 'd' }, { type: 'omniview:internal', title: 'T', status: 'x', detail: 'd' }, { type: 'omniview:internal', title: 'T', status: 99, detail: 'd' }, { type: 'omniview:internal', title: 'T', status: 500 }, { type: 'omniview:internal', title: 'T', status: 500, detail: 'x'.repeat(5000) }]) {
      expect(noticeFromHostError(broken)?.title).toBe('Operation failed');
    }
  });

  it('takes the caller\'s own words, for there is no class text to protect', () => {
    expect(noticeFromHostError(undefined, { title: 'Couldn\'t save the layout' })?.title).toBe('Couldn\'t save the layout');
  });

  it('says "Operation failed" for a title that only says "Error"', () => {
    expect(noticeFromHostError(envelope({ type: 'omniview:internal', title: 'Error', status: 500, detail: 'x', code: 'UNKNOWN_CLASS' }))?.title).toBe('Operation failed');
  });
});
