import { parseAppError } from '@omniviewdev/runtime/ui/v1';
import type { ResourceReference, Value } from '@omniviewdev/runtime/ui/v1';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { LOOPBACK } from '../../shell/panel/ports/model';
import type { PortForwardErrorCodeV1, PortForwardRequestV1 } from '../contract/v1';
import { PortForwardError, portsOf, type PortForwardStart, type PortForwardStarted, type PortForwardStop } from './portForward';

// What a page's `ctx.panel.ports.forward` does (PF1, `portForward.ts`): the plugin and the connection are the page's own, which the handle was made with; the request is the page's words (a resource and ports) and
// becomes the runtime's typed start; the host's answer becomes the forward the page holds (its id, the port it listens on, where the host reaches it and a way to stop it), and the Ports tool is shown once the forward
// is there. A refusal, and a start or a stop the host could not make, is a `PortForwardError`: the host's own code and plain words. The host's networker and the Ports tool are fakes here: no runtime, no window. The
// handle is tested with the registry beside it in `panelHost.test.ts`, and in the window in `PluginHost.ports.test.tsx`.

/** The words of what the host refuses before it asks anything. */
const REFUSED = {
  resource: 'The forward names no resource.',
  remote: 'The port of the resource must be a whole number from 1 to 65535.',
  local: 'The port on this computer must be a whole number from 1 to 65535, or left out to take a free one.',
  protocol: 'The protocol must be TCP or UDP.',
  none: 'The host did not start the forward.',
  noPort: 'The host did not say which port the forward listens on.',
} as const;

/** The words a code is given when the host gave none of its own that a person can read: the sentences of the host's own classes of error (`backend/pkg/apperror/resource.go`, `classifyResource`). */
const WORDS: Readonly<Record<PortForwardErrorCodeV1, string>> = {
  INVALID_REQUEST: 'The request is invalid.',
  UNSUPPORTED: 'This operation is not supported.',
  FORBIDDEN: 'The operation is not permitted.',
  UNAUTHORIZED: 'The provider requires authentication.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The operation conflicts with current state.',
  CANCELLED: 'The operation was cancelled.',
  TIMEOUT: 'The operation exceeded its deadline.',
  UNAVAILABLE: 'The source is unavailable.',
  CONNECTION_ERROR: 'The connection is not started, or could not be reached.',
  RESOURCE_LIMIT: 'The operation exceeds a host resource limit.',
  PROVIDER_ERROR: 'The provider could not complete the operation.',
  INTERNAL: 'The operation could not be completed.',
  UNKNOWN: 'The operation could not be completed.',
};

const GENERIC = WORDS.UNKNOWN;

type Setup = {
  readonly start?: PortForwardStart | undefined;
  readonly stop?: PortForwardStop | undefined;
  readonly reveal?: (() => void) | undefined;
  readonly plugin?: string;
  readonly connection?: string;
};

/** What a host answers for a forward it started: the session, as far as the window reads it. */
const started = (id = 'forward-1', port = 41_234): PortForwardStarted => ({ id, local_port: port });

/** The handle of a page of `acme` in `north`, over a networker that starts and stops a forward and a Ports tool that can be shown, unless the test says otherwise. */
function setup(over: Setup = {}) {
  const start = vi.fn<PortForwardStart>(over.start ?? (async () => started()));
  const stop = vi.fn<PortForwardStop>(over.stop ?? (async () => undefined));
  const reveal = vi.fn<() => void>(over.reveal ?? (() => undefined));
  const ports = portsOf({ start, stop, revealPortsTool: reveal }, over.plugin ?? 'acme', over.connection ?? 'north');
  return { ports, start, stop, reveal };
}

const request = (patch: Partial<PortForwardRequestV1> = {}): PortForwardRequestV1 => ({ resourceId: 'alpha', resourceKey: 'widgets', remotePort: 8080, ...patch });

const reference: ResourceReference = { address: { provider: 'acme', authority: 'north', type: 'widgets', scope: [], id: 'alpha' } };
const body: Value = { kind: 'map', value: { name: { kind: 'string', value: 'alpha' } } };

/** What the host's call rejects with, as the runtime delivers it (Wails' `CallError`): a `RuntimeError` whose message is the text of the Go error, and whose cause is the same error marshaled. */
function wire(cause: unknown): Error {
  const error = new Error(typeof cause === 'string' ? cause : JSON.stringify(cause), { cause });
  error.name = 'RuntimeError';
  return error;
}

/** An error of the plugin's SDK as the host passes it on (`{ code, title, message }`). */
const sdk = (code: string, message: string): { code: string; title: string; message: string } => ({ code, title: '', message });

/** An error of the host's own (`apperror.AppError`: the type says the class, and the code, when there is one, says it more closely). */
const envelope = (type: string, status: number, detail: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type, title: 'Failed', status, detail, ...extra });

/** The sentences of the host's own lookups, as it words them (`apperror.PluginNotFound`, `ConnectionNotFound` and `SessionNotFound`). */
const PLUGIN_GONE = 'No plugin with id \'acme\' was found.';
const CONNECTION_GONE = 'Connection \'north\' not found for plugin \'acme\'.';
const SESSION_GONE = 'Session \'forward-1\' was not found.';

/** A call that rejects with `value`, whatever it is: what the runtime rejects with is not always an `Error` (a call that was cancelled rejects with the text `cancelled`). */
// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the runtime's own cancellation is the string `cancelled`
const rejecting = (value: unknown) => async (): Promise<never> => Promise.reject(value);

/** The refusal a call rejects with: it fails the test when the call did not reject, or rejected with anything but a `PortForwardError`. */
async function refused(call: Promise<unknown>): Promise<PortForwardError> {
  const error: unknown = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof PortForwardError)) {
    throw new TypeError(`the call did not reject with a PortForwardError: ${String(error)}`);
  }

  return error;
}

/** Lets the promises that are ready run: a forward that was told to wait for the host does not show the tool in a turn of its own. */
async function turns(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a forward a page asks for', () => {
  it('is started in the page\'s own plugin and connection: the handle was made with them, the request names neither', async () => {
    const { ports, start } = setup({ plugin: 'acme', connection: 'north' });
    await ports.forward(request());
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.slice(0, 2)).toEqual(['acme', 'north']);
    expect(start.mock.calls[0]?.[2]).toMatchObject({ connection: { plugin_id: 'acme', connection_id: 'north' } });
  });

  it('cannot be started in another plugin\'s name, or another connection\'s, whatever the request carries', async () => {
    const { ports, start } = setup({ plugin: 'acme', connection: 'north' });
    // A request from a plugin written without the types: the extra members are not read.
    const extras: Record<string, unknown> = { pluginId: 'other', plugin_id: 'other', connectionId: 'south', connection_id: 'south' };
    const written: PortForwardRequestV1 = { ...request(), ...extras };
    await ports.forward(written);
    const [plugin, connection, options] = start.mock.calls[0] ?? [];
    expect([plugin, connection]).toEqual(['acme', 'north']);
    expect(options?.connection_type === 'RESOURCE' ? options.connection : undefined).toMatchObject({ plugin_id: 'acme', connection_id: 'north' });
    expect(JSON.stringify(options)).not.toContain('other');
    expect(JSON.stringify(options)).not.toContain('south');
  });

  it('maps a request of a resource and a port to the typed start exactly: a free local port, TCP, and no member the page did not give', async () => {
    const { ports, start } = setup();
    await ports.forward({ resourceId: 'alpha', remotePort: 8080 });
    expect(start.mock.calls[0]?.[2]).toStrictEqual({
      local_port: 0,
      remote_port: 8080,
      protocol: 'TCP',
      connection_type: 'RESOURCE',
      connection: { plugin_id: 'acme', connection_id: 'north', resource_id: 'alpha', resource_key: '' },
    });
  });

  it('maps a request that says everything to the typed start exactly: the ports, the protocol, the resource\'s key, reference and body, and the route the reference needs', async () => {
    const { ports, start } = setup();
    await ports.forward({ resourceId: 'alpha', resourceKey: 'widgets', reference, resourceData: body, remotePort: 8080, localPort: 9090, protocol: 'UDP' });
    expect(start.mock.calls[0]?.[2]).toStrictEqual({
      local_port: 9090,
      remote_port: 8080,
      protocol: 'UDP',
      connection_type: 'RESOURCE',
      connection: { plugin_id: 'acme', connection_id: 'north', resource_id: 'alpha', resource_key: 'widgets', reference, route: { connection: 'north' }, resource_data: body },
    });
  });

  it('gives the id as it was written: only a blank one is refused', async () => {
    const { ports, start } = setup();
    await ports.forward(request({ resourceId: ' alpha ' }));
    expect(start.mock.calls[0]?.[2]).toMatchObject({ connection: { resource_id: ' alpha ' } });
  });

  it('takes the first and the last port there are, for either end', async () => {
    const { ports, start } = setup();
    await ports.forward(request({ remotePort: 1, localPort: 65_535 }));
    await ports.forward(request({ remotePort: 65_535, localPort: 1 }));
    expect(start.mock.calls.map(([, , options]) => [options.remote_port, options.local_port])).toEqual([
      [1, 65_535],
      [65_535, 1],
    ]);
  });
});

describe('the route of a forward', () => {
  /** The route the typed start was given for the one forward a test made, or `undefined` when it was given none. */
  const routeOf = (start: Mock<PortForwardStart>): unknown => {
    const options = start.mock.calls[0]?.[2];
    return options?.connection_type === 'RESOURCE' ? options.connection.route : undefined;
  };

  it('is the page\'s connection when the request has a reference: the host\'s networker refuses a reference that has no route of the connection it is started in', async () => {
    const { ports, start } = setup();
    await ports.forward(request({ reference }));
    expect(routeOf(start)).toStrictEqual({ connection: 'north' });
  });

  it('is left out when the request has no reference: there is nothing for it to admit', async () => {
    const { ports, start } = setup();
    await ports.forward(request());
    const options = start.mock.calls[0]?.[2];
    expect(options?.connection_type === 'RESOURCE' ? Object.keys(options.connection).sort() : undefined).toEqual(['connection_id', 'plugin_id', 'resource_id', 'resource_key']);
  });

  it.each([
    ['another connection\'s', { connection: 'south' }],
    ['the page\'s own, with a member more', { connection: 'north', note: 'written without the types' }],
    ['empty', {}],
    ['nothing', null],
    ['text', 'south'],
  ])('is never what a plugin wrote, when it wrote %s route: the request has no member for one, so the host does not read it and the forward is made in the page\'s connection', async (_name, route) => {
    const { ports, start } = setup();
    // Requests from a plugin written without the types, which names a route the request has no member for.
    const extras: Record<string, unknown> = { route };
    const withReference: PortForwardRequestV1 = { ...request({ reference }), ...extras };
    const withoutReference: PortForwardRequestV1 = { ...request(), ...extras };
    await ports.forward(withReference);
    await ports.forward(withoutReference);
    const routes = start.mock.calls.map(([, connection, options]) => [connection, options.connection_type === 'RESOURCE' ? options.connection.route : 'static']);
    // With a reference: the page's connection, written by the host. Without: none, whatever was written.
    expect(routes).toStrictEqual([
      ['north', { connection: 'north' }],
      ['north', undefined],
    ]);
  });
});

describe('the forward a page is answered', () => {
  it('is the host\'s session as the page needs it: its id, the port it listens on, where the host reaches it, and a way to stop it', async () => {
    const { ports } = setup({ start: async () => started('forward-7', 41_999) });
    await expect(ports.forward(request())).resolves.toStrictEqual({ sessionId: 'forward-7', localPort: 41_999, localHost: '127.0.0.1', stop: expect.any(Function) });
  });

  it('says the port the host chose when the page asked for a free one: the answer is how a page learns it', async () => {
    const { ports, start } = setup({ start: async () => started('forward-1', 43_210) });
    const answer = await ports.forward(request());
    expect(start.mock.calls[0]?.[2]).toMatchObject({ local_port: 0 });
    expect(answer.localPort).toBe(43_210);
  });

  it('says the port the host states for the session, whatever was asked: the host\'s word is the one that says where the forward is', async () => {
    const { ports } = setup({ start: async () => started('forward-1', 9_191) });
    expect((await ports.forward(request({ localPort: 9_090 }))).localPort).toBe(9_191);
  });

  it('says the address as the loopback, the one the Ports tool says too: a single constant, because the host assumes it and the producer states no address', async () => {
    const { ports } = setup();
    const answer = await ports.forward(request());
    expect(answer.localHost).toBe(LOOPBACK);
    expect(answer.localHost).toBe('127.0.0.1');
  });

  it('is one object nobody can change: a page that holds it cannot make it say another port or another way to stop', async () => {
    const { ports } = setup();
    const answer = await ports.forward(request());
    expect(Object.isFrozen(answer)).toBe(true);
    expect(Reflect.set(answer, 'localPort', 1)).toBe(false);
    expect(answer.localPort).toBe(41_234);
  });

  it('is a new one for each forward, each with a stop of its own', async () => {
    const { ports } = setup({ start: vi.fn<PortForwardStart>().mockResolvedValueOnce(started('first', 41_001)).mockResolvedValueOnce(started('second', 41_002)) });
    const first = await ports.forward(request());
    const second = await ports.forward(request());
    expect([first.sessionId, second.sessionId]).toEqual(['first', 'second']);
    expect(first.stop).not.toBe(second.stop);
  });

  it.each([
    ['0 (the host has not assigned one)', 0],
    ['one past the last', 65_536],
    ['negative', -1],
    ['not whole', 1.5],
    ['not a number', Number.NaN],
    ['text', '8080'],
    ['absent', undefined],
  ])('is not given when the host\'s port is %s: the forward is ended and the call rejects, because a forward that cannot be told to the page is one nobody can address', async (_name, port) => {
    // What the host answers is data from outside: it is a port that is not one that this test says it answers.
    const answer: PortForwardStarted = { id: 'forward-9', local_port: port as number };
    const { ports, stop, reveal } = setup({ start: async () => answer });
    const error = await refused(ports.forward(request()));
    expect(error).toMatchObject({ name: 'PortForwardError', code: 'UNKNOWN', message: REFUSED.noPort });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith('forward-9');
    expect(reveal).not.toHaveBeenCalled();
  });

  it('says the same when that forward cannot be ended either: the console says so, and the call still rejects with the words of the answer', async () => {
    const { ports, stop } = setup({
      start: async () => ({ id: 'forward-9', local_port: 0 }),
      stop: async () => Promise.reject(wire(sdk('PROVIDER_ERROR', 'the plugin did not answer'))),
    });
    const error = await refused(ports.forward(request()));
    expect(error.message).toBe(REFUSED.noPort);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toMatch(/^\[ports\]/);
  });

  it.each([
    ['no forward', async (): Promise<PortForwardStarted> => Promise.resolve(null)],
    ['a forward with no id', async (): Promise<PortForwardStarted> => Promise.resolve({ id: '', local_port: 41_234 })],
  ])('is not given when the host answers %s: there is nothing to stop, and the call rejects', async (_name, host) => {
    const { ports, stop, reveal } = setup({ start: host });
    const error = await refused(ports.forward(request()));
    expect(error).toMatchObject({ name: 'PortForwardError', code: 'UNKNOWN', message: REFUSED.none });
    expect(stop).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe('stopping the forward a page holds', () => {
  it('closes this forward through the host, by its id, and answers nothing but that it worked', async () => {
    const { ports, stop } = setup({ start: async () => started('forward-3') });
    const answer = await ports.forward(request());
    expect(stop).not.toHaveBeenCalled();
    await expect(answer.stop()).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith('forward-3');
  });

  it('closes the forward it came with and no other: each answer stops its own', async () => {
    const { ports, stop } = setup({ start: vi.fn<PortForwardStart>().mockResolvedValueOnce(started('first', 41_001)).mockResolvedValueOnce(started('second', 41_002)) });
    const first = await ports.forward(request());
    const second = await ports.forward(request());
    await second.stop();
    expect(stop.mock.calls).toEqual([['second']]);
    await first.stop();
    expect(stop.mock.calls).toEqual([['second'], ['first']]);
  });

  it('asks the host once, however often it is called: a second call is the first\'s outcome, and a call that comes while the host is still closing it waits for the same answer', async () => {
    const gate = Promise.withResolvers<undefined>();
    const { ports, stop } = setup({ stop: async () => gate.promise });
    const answer = await ports.forward(request());
    const first = answer.stop();
    const second = answer.stop();
    await turns();
    expect(stop).toHaveBeenCalledTimes(1);
    gate.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await expect(answer.stop()).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('is the same refusal when the host refused the first: it is not asked again, and every call hears the one error', async () => {
    const { ports, stop } = setup({ stop: async () => Promise.reject(wire(sdk('UNAVAILABLE', 'the plugin did not answer in time'))) });
    const answer = await ports.forward(request());
    const first = await refused(answer.stop());
    const second = await refused(answer.stop());
    expect(second).toBe(first);
    expect(first).toMatchObject({ name: 'PortForwardError', code: 'UNAVAILABLE', message: 'the plugin did not answer in time' });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('succeeds for a forward the host no longer has: it was stopped already (by the person, or by another window), and what the caller wants is that it does not run', async () => {
    const gone = wire(envelope('omniview:session/not-found', 404, SESSION_GONE, { instance: 'forward-1' }));
    const { ports, stop } = setup({ stop: async () => Promise.reject(gone) });
    const answer = await ports.forward(request());
    await expect(answer.stop()).resolves.toBeUndefined();
    await expect(answer.stop()).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the plugin that holds it is not there', wire(envelope('omniview:plugin/not-found', 404, PLUGIN_GONE)), 'NOT_FOUND', PLUGIN_GONE],
    ['the plugin did not answer', wire(sdk('UNAVAILABLE', 'the plugin is not answering')), 'UNAVAILABLE', 'the plugin is not answering'],
    ['the host failed in a way it did not classify', new Error('boom\n    at close (file.js:1:2)'), 'UNKNOWN', GENERIC],
    ['the call was cancelled', 'cancelled', 'CANCELLED', WORDS.CANCELLED],
  ])('is refused in the host\'s own code and plain words when %s', async (_name, rejection, code, words) => {
    const { ports } = setup({ stop: rejecting(rejection) });
    const answer = await ports.forward(request());
    const error = await refused(answer.stop());
    expect(error).toMatchObject({ name: 'PortForwardError', code, message: words });
    expect(error.cause).toBe(rejection);
  });

  it('is a refusal too when the call to the host throws before it asks: the page hears of it as of any other', async () => {
    const thrown = new TypeError('the runtime is not there');
    const { ports } = setup({
      stop: () => {
        throw thrown;
      },
    });
    const answer = await ports.forward(request());
    const error = await refused(answer.stop());
    expect(error).toMatchObject({ code: 'UNKNOWN', message: GENERIC });
    expect(error.cause).toBe(thrown);
  });

  it('starts nothing and shows nothing: the Ports tool was shown for the forward, and a stop is not a reason to show it again', async () => {
    const { ports, start, reveal } = setup();
    const answer = await ports.forward(request());
    await answer.stop();
    expect(start).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledTimes(1);
  });
});

describe('the Ports tool', () => {
  it('is shown once, after the host has started the forward, and not before', async () => {
    const gate = Promise.withResolvers<PortForwardStarted>();
    const { ports, start, reveal } = setup({ start: async () => gate.promise });
    const pending = ports.forward(request());
    await turns();
    expect(start).toHaveBeenCalledTimes(1);
    expect(reveal).not.toHaveBeenCalled();
    gate.resolve(started());
    await expect(pending).resolves.toMatchObject({ sessionId: 'forward-1' });
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('is shown once for each forward that started', async () => {
    const { ports, reveal } = setup();
    await ports.forward(request());
    await ports.forward(request({ remotePort: 9000 }));
    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it('is not shown when the host refuses the forward', async () => {
    const { ports, reveal } = setup({ start: async () => Promise.reject(wire(sdk('PROVIDER_ERROR', 'port 8080 is unavailable'))) });
    await refused(ports.forward(request()));
    expect(reveal).not.toHaveBeenCalled();
  });

  it('may fail to show without failing the forward: the forward started, so the answer is the forward, and the console says what happened', async () => {
    const { ports, reveal } = setup({
      reveal: () => {
        throw new Error('there is no Ports tool');
      },
    });
    await expect(ports.forward(request())).resolves.toMatchObject({ sessionId: 'forward-1', localPort: 41_234 });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toMatch(/^\[ports\]/);
  });
});

describe('a request the host refuses before it asks anything', () => {
  /** The call is refused: it rejects with the words, as the host's own `INVALID_REQUEST`, and neither the networker nor the Ports tool was asked. */
  async function refuses(given: unknown, words: string): Promise<void> {
    const { ports, start, reveal } = setup();
    const error = await refused(ports.forward(given as PortForwardRequestV1));
    expect(error).toMatchObject({ name: 'PortForwardError', code: 'INVALID_REQUEST', message: words });
    expect(start).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  }

  it.each([
    ['no id', { remotePort: 8080 }],
    ['an empty id', { resourceId: '', remotePort: 8080 }],
    ['a blank id', { resourceId: '  \t', remotePort: 8080 }],
    ['an id that is not text', { resourceId: 7, remotePort: 8080 }],
  ])('is a resource with %s', async (_name, given) => {
    await refuses(given, REFUSED.resource);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['text', 'alpha'],
  ])('is a request that is %s', async (_name, given) => {
    await refuses(given, REFUSED.resource);
  });

  it.each([
    ['0', 0],
    ['one past the last', 65_536],
    ['negative', -1],
    ['not whole', 1.5],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['text', '8080'],
    ['null', null],
    ['absent', undefined],
  ])('is a port of the resource that is %s', async (_name, remotePort) => {
    await refuses({ ...request(), remotePort }, REFUSED.remote);
  });

  it.each([
    ['0 (a free port is asked for by leaving it out)', 0],
    ['one past the last', 65_536],
    ['negative', -80],
    ['not whole', 80.5],
    ['not a number', Number.NaN],
    ['text', '80'],
    ['null', null],
  ])('is a port on this computer that is %s', async (_name, localPort) => {
    await refuses({ ...request(), localPort }, REFUSED.local);
  });

  it.each([
    ['in lower case', 'tcp'],
    ['another one', 'HTTP'],
    ['empty', ''],
    ['null', null],
  ])('is a protocol that is %s', async (_name, protocol) => {
    await refuses({ ...request(), protocol }, REFUSED.protocol);
  });

  it('is a rejection, whatever is wrong: the call never throws into the page, so a plugin that waits for its answer in a chain of promises hears of it', async () => {
    const { ports } = setup();
    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = ports.forward({ ...request(), remotePort: 0 });
    }).not.toThrow();
    await expect(pending).rejects.toBeInstanceOf(PortForwardError);
  });
});

describe('a forward the host could not start', () => {
  /** The refusal the call rejects with, when the host's start fails in the way `fail` says. */
  async function refusal(fail: () => Promise<PortForwardStarted>): Promise<PortForwardError> {
    const { ports } = setup({ start: fail });
    return refused(ports.forward(request()));
  }

  /** The 20 MiB body: a host that is told of a limit by an error of the SDK whose own message is the JSON of another (`Operation failed: {...}` is what the runtime reads out of it). */
  const INNER = '{"code":"RESOURCE_LIMIT","title":"","message":"JSON byte limit"}';
  const RAW = `Operation failed: ${INNER}`;
  const DOUBLY_WRAPPED = envelope('omniview:resource/limit', 429, JSON.stringify({ code: 'RESOURCE_LIMIT', title: '', message: INNER }), { code: 'RESOURCE_LIMIT', title: 'Resource limit' });

  it.each([
    ['a port that is in use', wire(sdk('PROVIDER_ERROR', 'port 8080 is unavailable')), 'PROVIDER_ERROR', WORDS.PROVIDER_ERROR],
    ['a resource no forwarder takes', wire(sdk('PROVIDER_ERROR', 'no handler found for resource "nope"')), 'PROVIDER_ERROR', WORDS.PROVIDER_ERROR],
    ['a privileged port', wire(sdk('UNAVAILABLE', 'listen tcp 127.0.0.1:80: bind: permission denied')), 'UNAVAILABLE', 'listen tcp 127.0.0.1:80: bind: permission denied'],
    ['a protocol the forwarder does not take', wire(sdk('INVALID_REQUEST', 'UDP is not supported')), 'INVALID_REQUEST', 'UDP is not supported'],
    ['a connection that is not started', wire(sdk('CONNECTION_ERROR', 'the connection is not started')), 'CONNECTION_ERROR', 'the connection is not started'],
    ['a plugin the host does not have', wire(envelope('omniview:plugin/not-found', 404, PLUGIN_GONE)), 'NOT_FOUND', PLUGIN_GONE],
    ['a connection the host does not have', wire(envelope('omniview:connection/not-found', 404, CONNECTION_GONE)), 'NOT_FOUND', CONNECTION_GONE],
    ['a host that gave its class and a code', wire(envelope('omniview:resource/provider-error', 502, WORDS.PROVIDER_ERROR, { code: 'PROVIDER_ERROR' })), 'PROVIDER_ERROR', WORDS.PROVIDER_ERROR],
    ['access that is not permitted', wire(sdk('PERMISSION_DENIED', 'no')), 'FORBIDDEN', WORDS.FORBIDDEN],
    ['an operation that was cancelled', 'cancelled', 'CANCELLED', WORDS.CANCELLED],
    ['an error that is not the host\'s at all', new Error('boom'), 'UNKNOWN', GENERIC],
  ])('says the host\'s own code and its plain words for %s', async (_name, rejection, code, words) => {
    const error = await refusal(rejecting(rejection));
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'PortForwardError', code, message: words });
  });

  it('keeps what the host gave, as the runtime delivered it, as the cause, and nothing of it in the message', async () => {
    const rejection = wire(sdk('PROVIDER_ERROR', 'port 8080 is unavailable'));
    const error = await refusal(rejecting(rejection));
    expect(error.cause).toBe(rejection);
  });

  it('says a code for every class the contract lists, and the words of the host\'s own class for it when the host gave none a person can read', async () => {
    for (const [code, words] of Object.entries(WORDS) as Array<[PortForwardErrorCodeV1, string]>) {
      // An answer that has the class and no words: an error of the SDK with no message, and for UNKNOWN an error that is not the host's.
      const rejection = code === 'UNKNOWN' ? new Error('boom') : wire(sdk(code, ''));
      const error = await refusal(rejecting(rejection));
      expect([code, error.code, error.message]).toEqual([code, code, words]);
    }
  });

  it.each([
    ['ALREADY_EXISTS', 'CONFLICT'],
    ['CERTIFICATE_ERROR', 'CONNECTION_ERROR'],
  ])('says %s as %s: the host\'s own classes put them together', async (given, code) => {
    const error = await refusal(async () => Promise.reject(wire(sdk(given, ''))));
    expect(error.code).toBe(code);
  });

  it.each([
    ['PARTIAL_RESULT'],
    ['CONTINUATION_EXPIRED'],
    ['RESET_REQUIRED'],
  ])('says %s as UNKNOWN: a class a forward does not meet is not one the contract lists', async (given) => {
    const error = await refusal(async () => Promise.reject(wire(sdk(given, 'the host said so'))));
    expect(error.code).toBe('UNKNOWN');
  });

  it('says UNKNOWN for a code a later host adds, and reads the type of the answer when there is no code: the class is the type\'s', async () => {
    const later = await refusal(async () => Promise.reject(wire(envelope('omniview:resource/provider-error', 502, 'a new class', { code: 'SOMETHING_NEW' }))));
    expect(later.code).toBe('UNKNOWN');
    const byType = await refusal(async () => Promise.reject(wire(envelope('omniview:resource/limit', 429, 'too large'))));
    expect(byType.code).toBe('RESOURCE_LIMIT');
  });

  it('says UNKNOWN, and no more than the one sentence, for an answer the host\'s own error cannot be read from: the internal class of an envelope with no code is not a code', async () => {
    const error = await refusal(async () => Promise.reject(wire(envelope('omniview:internal', 500, 'It broke.'))));
    expect(error.code).toBe('UNKNOWN');
  });

  it('never says raw JSON: the refusal of a body over the host\'s limit, read as the host\'s error, is its code and the words of its class', async () => {
    // The runtime reads this envelope as the sentence `Operation failed: {"code":...}`: the precondition of the test, so that it cannot pass by reading nothing.
    expect(parseAppError(wire(DOUBLY_WRAPPED)).detail).toBe(RAW);
    const error = await refusal(async () => Promise.reject(wire(DOUBLY_WRAPPED)));
    expect(error.code).toBe('RESOURCE_LIMIT');
    expect(error.message).toBe(WORDS.RESOURCE_LIMIT);
    expect(error.message).not.toMatch(/[{}"]/);
  });

  it('never says raw JSON when the same refusal comes as text: it is read as the host\'s error, and what is left of it is plain', async () => {
    const error = await refusal(async () => Promise.reject(new Error(RAW)));
    expect(error.code).toBe('RESOURCE_LIMIT');
    expect(error.message).not.toMatch(/[{}"]/);
    expect(error.message).not.toContain('code');
  });

  it.each([
    ['a key and a value', 'the request was refused: "limit": 1048576'],
    ['a page of output', 'could not dial the server\n    at dial (net.js:1:2)\ngoroutine 12 [running]'],
    ['a stack frame', 'failed at start (file.js:10:5)'],
    ['a line that is too long', 'x'.repeat(201)],
    ['nothing', '   '],
  ])('never says %s: a sentence of the host that is not a plain line gives way to the words of its class', async (_name, detail) => {
    const error = await refusal(async () => Promise.reject(wire(envelope('omniview:plugin/not-found', 404, detail))));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe(WORDS.NOT_FOUND);
  });

  // The runtime passes the sentence of an error of the plugin's SDK on as it is (an error of the host's own it scrubs of what looks like JSON), so these are the ones that reach the check for a dump.
  it.each([
    ['a Go struct', 'listen failed {Op:listen Net:tcp Addr:0xc000123} bind: address already in use'],
    ['a JSON object after a few words', 'the forwarder said {"limit": 1}'],
    ['a key and a value', 'the request was refused: "limit": 1048576'],
  ])('never says %s, in the sentence of the plugin\'s own error: it is not read out, and the code is still the host\'s', async (_name, message) => {
    const error = await refusal(rejecting(wire(sdk('UNAVAILABLE', message))));
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toBe(WORDS.UNAVAILABLE);
  });

  it('says the sentence of the host as it is when it is one plain line: a sentence with a colon, an address and a bracketed one is plain', async () => {
    const sentence = 'listen tcp [::1]:8080: bind: address already in use';
    const error = await refusal(async () => Promise.reject(wire(sdk('UNAVAILABLE', sentence))));
    expect(error.message).toBe(sentence);
  });

  it('says the words of the class when the host\'s own sentence is the runtime\'s general one, which says less than the class does', async () => {
    const error = await refusal(async () => Promise.reject(wire(envelope('omniview:resource/provider-error', 502, GENERIC, { code: 'PROVIDER_ERROR' }))));
    expect(error.message).toBe(WORDS.PROVIDER_ERROR);
  });

  it('is a refusal too when the typed start throws before it asks the host: the encoder refuses a request that is not plain data', async () => {
    const thrown = new RangeError('Request JSON byte limit');
    const error = await refusal(() => {
      throw thrown;
    });
    expect(error).toMatchObject({ name: 'PortForwardError', code: 'UNKNOWN', message: GENERIC });
    expect(error.cause).toBe(thrown);
  });

  it('is never a stack: the message is one plain sentence, and the stack of the original is the cause\'s', async () => {
    const original = new Error('boom\n    at start (file.js:10:5)\n    at forward (file.js:20:7)');
    const error = await refusal(async () => Promise.reject(original));
    expect(error.message).toBe(GENERIC);
    expect(error.message).not.toMatch(/\bat\b.*:\d+:\d+|\n|boom/);
    expect(error.cause).toBe(original);
  });
});

describe('PortForwardError', () => {
  it('is an `Error` that is told by its name, with the code the host\'s answer had, plain words and the error that caused it', () => {
    const cause = new Error('the host said so');
    const error = new PortForwardError('PROVIDER_ERROR', 'The provider could not complete the operation.', { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PortForwardError');
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.message).toBe('The provider could not complete the operation.');
    expect(error.cause).toBe(cause);
  });

  it('has a cause only when it is given one', () => {
    expect(new PortForwardError('INVALID_REQUEST', 'The forward names no resource.').cause).toBeUndefined();
    expect('cause' in new PortForwardError('INVALID_REQUEST', 'The forward names no resource.')).toBe(false);
  });
});
