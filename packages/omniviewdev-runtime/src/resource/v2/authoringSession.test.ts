import { describe, expect, it, vi, type Mock } from 'vitest';
import type { AuthoringIdentity, AuthoringTarget, CompletionRequest, CompletionResponse } from './authoring';
import { createCompletionSession } from './authoringSession';
import type { CompletionInput } from './authoringSession';

interface Pending {
  request: CompletionRequest;
  resolve: (response: CompletionResponse) => void;
  reject: (error: unknown) => void;
  cancel: Mock;
}

function fakeTransport() {
  const calls: Pending[] = [];
  const call = (_plugin: string, request: CompletionRequest) => {
    const cancel = vi.fn();
    const { promise, resolve, reject } = Promise.withResolvers<CompletionResponse>();
    calls.push({ request, resolve, reject, cancel });
    return Object.assign(promise, { cancel });
  };
  return { calls, call };
}

const target: AuthoringTarget = { route: { connection: 'c1' }, type: 'pods', scope: [] };
const baseIdentity: AuthoringIdentity = {
  plugin: 'p',
  provider: 'prov',
  connection: 'c1',
  type: 'pods',
  representation: 'default',
  scopeKey: 'sk',
  catalogRevision: 'cat1',
  representationRevision: 'rep1',
  schemaRevision: 'sch1',
  environmentRevision: 'env1',
  accessGeneration: 'acc1',
};

function respond(request: CompletionRequest, identity: Partial<AuthoringIdentity> = {}): CompletionResponse {
  return {
    version: request.version,
    requestId: request.requestId,
    documentId: request.documentId,
    documentRevision: request.documentRevision,
    cursor: request.cursor,
    identity: { ...baseIdentity, ...identity },
    schema: { state: 'available', validation: 'full', hostEvaluation: 'schemaChecked' },
    context: {
      kind: 'expression',
      draft: 'valid',
      prefix: '',
      replace: { start: 0, end: 0, unit: 'utf8-byte' },
    },
    items: [],
    completion: { kind: 'complete' },
    maxSuggestions: request.maxSuggestions,
  };
}

const input = (overrides: Partial<CompletionInput> = {}): CompletionInput => ({
  source: 'resource.',
  cursor: 9,
  target,
  maxSuggestions: 50,
  ...overrides,
});

const appError = (code: string) => ({ type: 'x', title: 't', status: 400, detail: 'd', code });

function setup() {
  const transport = fakeTransport();
  const session = createCompletionSession({ pluginID: 'p', documentID: 'doc', call: transport.call });
  return { ...transport, session };
}

async function tick(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

describe('createCompletionSession', () => {
  it('sends monotonic revisions, byte cursors and omits absent optional members', async () => {
    const { calls, session } = setup();
    const first = session.complete(input({ source: '\ud83d\ude00.', cursor: 3 }));
    expect(calls[0].request.documentRevision).toBe(1);
    expect(calls[0].request.cursor).toEqual({ offset: 5, unit: 'utf8-byte' });
    expect(Object.keys(calls[0].request).sort()).toEqual(
      ['cursor', 'documentId', 'documentRevision', 'maxSuggestions', 'profile', 'requestId', 'source', 'target', 'version'].sort(),
    );
    expect(calls[0].request.target).toEqual({ route: { connection: 'c1' }, type: 'pods', scope: [] });
    calls[0].resolve(respond(calls[0].request));
    expect((await first).status).toBe('applied');
    void session.complete(input());
    expect(calls[1].request.documentRevision).toBe(2);
  });

  it('rejects a cursor inside a surrogate pair without disturbing the in-flight request', async () => {
    const { calls, session } = setup();
    const first = session.complete(input());
    await expect(session.complete(input({ source: '\ud83d\ude00', cursor: 1 }))).rejects.toThrow(RangeError);
    expect(calls[0].cancel).not.toHaveBeenCalled();
    calls[0].resolve(respond(calls[0].request));
    expect((await first).status).toBe('applied');
  });

  it('cancels the previous request on rapid revisions and discards the late older response', async () => {
    const { calls, session } = setup();
    const first = session.complete(input());
    const second = session.complete(input());
    expect(calls[0].cancel).toHaveBeenCalledTimes(1);
    calls[1].resolve(respond(calls[1].request));
    calls[0].resolve(respond(calls[0].request));
    expect(await second).toMatchObject({ status: 'applied' });
    expect(await first).toEqual({ status: 'stale', reason: 'superseded' });
  });

  it('reports a superseded request that rejects as cancelled', async () => {
    const { calls, session } = setup();
    const first = session.complete(input());
    void session.complete(input());
    calls[0].reject(new Error('transport cancel'));
    expect(await first).toEqual({ status: 'cancelled' });
  });

  it('maps CANCELLED to cancelled', async () => {
    const { calls, session } = setup();
    const result = session.complete(input());
    calls[0].reject(appError('CANCELLED'));
    expect(await result).toEqual({ status: 'cancelled' });
  });

  it('rethrows other errors', async () => {
    const { calls, session } = setup();
    const result = session.complete(input());
    const failure = appError('FORBIDDEN');
    calls[0].reject(failure);
    await expect(result).rejects.toBe(failure);
  });

  it('discards a response made stale by a target switch mid-flight', async () => {
    const { calls, session } = setup();
    const first = session.complete(input());
    const other: AuthoringTarget = { route: { connection: 'c2' }, type: 'pods', scope: [] };
    const second = session.complete(input({ target: other }));
    calls[0].resolve(respond(calls[0].request));
    expect(await first).toEqual({ status: 'stale', reason: 'superseded' });
    calls[1].resolve(respond(calls[1].request, { connection: 'c2' }));
    expect(await second).toMatchObject({ status: 'applied' });
  });

  it('sends expectations after a response and omits them after a target change or invalidate', async () => {
    const { calls, session } = setup();
    const first = session.complete(input());
    calls[0].resolve(respond(calls[0].request));
    await first;

    const second = session.complete(input());
    expect(calls[1].request).toMatchObject({
      catalogRevision: 'cat1',
      representationRevision: 'rep1',
      schemaRevision: 'sch1',
      environmentRevision: 'env1',
      accessGeneration: 'acc1',
    });
    calls[1].resolve(respond(calls[1].request));
    await second;

    void session.complete(input({ declarations: { x: { kind: 'string' } } }));
    expect(calls[2].request.catalogRevision).toBeUndefined();
    expect(calls[2].request.declarations).toEqual({ x: { kind: 'string' } });
    calls[2].resolve(respond(calls[2].request));
    await tick();

    void session.complete(input({ declarations: { x: { kind: 'string' } } }));
    expect(calls[3].request.catalogRevision).toBe('cat1');
    calls[3].resolve(respond(calls[3].request));
    await tick();

    session.invalidate();
    void session.complete(input({ declarations: { x: { kind: 'string' } } }));
    expect(calls[4].request.catalogRevision).toBeUndefined();
    expect(Object.keys(calls[4].request)).not.toContain('accessGeneration');
  });

  it('invalidate cancels the in-flight request and discards its response', async () => {
    const { calls, session } = setup();
    const first = session.complete(input());
    session.invalidate();
    expect(calls[0].cancel).toHaveBeenCalledTimes(1);
    calls[0].resolve(respond(calls[0].request));
    expect(await first).toEqual({ status: 'stale', reason: 'invalidated' });
  });

  it('retries exactly once without expectations on RESET_REQUIRED', async () => {
    const { calls, session } = setup();
    const seeded = session.complete(input());
    calls[0].resolve(respond(calls[0].request));
    await seeded;

    const result = session.complete(input());
    expect(calls[1].request.catalogRevision).toBe('cat1');
    calls[1].reject(appError('RESET_REQUIRED'));
    await tick();
    expect(calls).toHaveLength(3);
    expect(calls[2].request.catalogRevision).toBeUndefined();
    expect(calls[2].request.accessGeneration).toBeUndefined();
    expect(calls[2].request.documentRevision).toBe(3);
    calls[2].resolve(respond(calls[2].request, { catalogRevision: 'cat2' }));
    expect(await result).toMatchObject({ status: 'applied' });
  });

  it('surfaces a second RESET_REQUIRED', async () => {
    const { calls, session } = setup();
    const result = session.complete(input());
    calls[0].reject(appError('RESET_REQUIRED'));
    await tick();
    expect(calls).toHaveLength(2);
    const failure = appError('RESET_REQUIRED');
    calls[1].reject(failure);
    await expect(result).rejects.toBe(failure);
    expect(calls).toHaveLength(2);
  });

  it('does not retry when superseded during RESET_REQUIRED', async () => {
    const { calls, session } = setup();
    const first = session.complete(input());
    void session.complete(input());
    calls[0].reject(appError('RESET_REQUIRED'));
    expect(await first).toEqual({ status: 'cancelled' });
    expect(calls).toHaveLength(2);
  });

  it('dispose cancels in flight, discards the response and refuses new requests', async () => {
    const { calls, session } = setup();
    const first = session.complete(input());
    session.dispose();
    expect(calls[0].cancel).toHaveBeenCalledTimes(1);
    calls[0].resolve(respond(calls[0].request));
    expect(await first).toEqual({ status: 'stale', reason: 'disposed' });
    await expect(session.complete(input())).rejects.toThrow('disposed');
  });

  describe('response verification', () => {
    const mutations: [string, (r: CompletionResponse) => CompletionResponse][] = [
      ['documentId', (r) => ({ ...r, documentId: 'other' })],
      ['documentRevision', (r) => ({ ...r, documentRevision: r.documentRevision + 1 })],
      ['requestId', (r) => ({ ...r, requestId: 'other' })],
      ['cursor', (r) => ({ ...r, cursor: { ...r.cursor, offset: r.cursor.offset + 1 } })],
    ];
    for (const [reason, mutate] of mutations) {
      it(`rejects a mismatched ${reason}`, async () => {
        const { calls, session } = setup();
        const result = session.complete(input());
        calls[0].resolve(mutate(respond(calls[0].request)));
        expect(await result).toEqual({ status: 'stale', reason });
      });
    }

    const members: (keyof AuthoringIdentity)[] = [
      'plugin',
      'provider',
      'connection',
      'type',
      'representation',
      'scopeKey',
      'catalogRevision',
      'representationRevision',
      'schemaRevision',
      'environmentRevision',
      'accessGeneration',
    ];
    for (const member of members) {
      it(`rejects a mismatched identity.${member}`, async () => {
        const { calls, session } = setup();
        // Seed a baseline, then answer the follow-up with one drifted member.
        const seeded = session.complete(
          input({ target: { ...target, representation: 'default' } }),
        );
        calls[0].resolve(respond(calls[0].request));
        await seeded;
        const result = session.complete(
          input({ target: { ...target, representation: 'default' } }),
        );
        calls[1].resolve(respond(calls[1].request, { [member]: 'drifted' }));
        expect(await result).toEqual({ status: 'stale', reason: `identity.${member}` });
        // Drift forces a resync: the next request carries no expectations.
        void session.complete(input({ target: { ...target, representation: 'default' } }));
        expect(calls[2].request.catalogRevision).toBeUndefined();
      });
    }
  });
});
