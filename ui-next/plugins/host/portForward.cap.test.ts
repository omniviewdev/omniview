import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortForwardRequestV1, PortForwardSessionV1 } from '../contract/v1';
import {
  MAX_FORWARDS_PER_CONNECTION,
  MAX_FORWARDS_PER_WINDOW,
  PortForwardError,
  portsOf,
  type PortForwardStart,
  type PortForwardStarted,
  type PortForwardStop,
  type PortForwarding,
} from './portForward';
import { createForwardLedger } from './portLedger';
import { ledgerWorld } from './portTesting';

// PF2, S4 of the review: a window holds a bounded number of forwards, and the number is exact. The window counts a forward from the call, before the networker answers, so a thousand calls made at once of a networker that is
// slow end at the cap and not a thousand starts; it gives the place back when the start fails, when the page stops the forward, when the host says the forward is closed and when its plugin stops. The cap is the window's: across
// windows the host has no owner for a forward, so another window counts its own. The networker, the host's closed events and the window's word on which plugins run are fakes; the order in which they answer is the test's.

const request: PortForwardRequestV1 = { resourceId: 'alpha', resourceKey: 'widgets', remotePort: 8080 };

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

/** What a list holds at an index, which the test has said is there. */
function at<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) {
    throw new RangeError(`nothing at ${String(index)}`);
  }

  return found;
}

/** What the host's call rejects with for a forward it does not have, as the runtime delivers it: an error whose message is the text of the host's own error, which the runtime reads by its type. */
const GONE = new Error(JSON.stringify({ type: 'omniview:session/not-found', title: 'Failed', status: 404, detail: 'Session \'forward-1\' was not found.' }));
GONE.name = 'RuntimeError';

/** The words of the two caps. */
const FULL = {
  connection: 'This plugin already holds 64 forwards in this connection. Stop one first.',
  window: 'This window already holds 128 forwards. Stop one first.',
} as const;

/**
 * A window: a networker whose starts are answered at once with a new forward each, or, while the test says they are slow, when it settles them; one count of forwards shared by every handle, as `panelHostsOf` shares it; and the
 * feeds that count listens to.
 */
function windowOf() {
  const world = ledgerWorld();
  const held: Array<() => void> = [];
  let slow = false;
  let inside = true;
  let issued = 0;
  const next = (): PortForwardStarted => {
    issued += 1;
    return { id: `forward-${String(issued)}`, local_port: 40_000 + issued };
  };

  const start = vi.fn<PortForwardStart>(async () => {
    if (!slow) {
      return next();
    }

    const gate = Promise.withResolvers<PortForwardStarted>();
    held.push(() => {
      gate.resolve(next());
    });
    return gate.promise;
  });
  const stop = vi.fn<PortForwardStop>(async () => undefined);
  const reveal = vi.fn<() => void>();
  const forwarding: PortForwarding = { start, stop, onClosed: world.deps.onClosed, plugins: world.deps.plugins, revealPortsTool: reveal, userActivation: () => inside };
  const ledger = createForwardLedger(forwarding, { connection: MAX_FORWARDS_PER_CONNECTION, window: MAX_FORWARDS_PER_WINDOW });
  return {
    world,
    start,
    stop,
    reveal,
    handle: (plugin: string, connection: string) => portsOf(forwarding, ledger, plugin, connection),
    /** While it is on, the networker answers a start when `settleAll` says so; off, it answers at once. */
    slow: (value = true) => {
      slow = value;
    },
    /** Answers every start that is under way. */
    settleAll: () => {
      for (const settle of held.splice(0)) {
        settle();
      }
    },
    /** Whether the window is in the middle of a user action. */
    acting: (value: boolean) => {
      inside = value;
    },
  };
}

type Ports = ReturnType<ReturnType<typeof windowOf>['handle']>;

/** Forwards `count` times through `ports`, one after the other, and answers what the page was given. */
async function forwardTimes(ports: Ports, count: number): Promise<PortForwardSessionV1[]> {
  const answers: PortForwardSessionV1[] = [];
  for (let one = 0; one < count; one += 1) {
    answers.push(await ports.forward(request));
  }

  return answers;
}

/** The call starts: it is answered with a forward. */
async function starts(ports: Ports): Promise<void> {
  await expect(ports.forward(request)).resolves.toMatchObject({ localPort: expect.any(Number) });
}

const fulfilled = (settled: PromiseSettledResult<unknown>): boolean => settled.status === 'fulfilled';

/** The refusals among the outcomes of calls that were all made. */
const refusalsOf = (outcomes: ReadonlyArray<PromiseSettledResult<unknown>>): unknown[] => outcomes.flatMap((settled) => (settled.status === 'rejected' ? [settled.reason] : []));

/** What a call that was answered gave the page. */
const answersOf = (outcomes: ReadonlyArray<PromiseSettledResult<PortForwardSessionV1>>): PortForwardSessionV1[] => outcomes.flatMap((settled) => (settled.status === 'fulfilled' ? [settled.value] : []));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the forwards a plugin may hold in a connection', () => {
  it('are at most the cap: the next is refused RESOURCE_LIMIT with the number and the words that say it, and the networker is not asked', async () => {
    const { handle, start, reveal } = windowOf();
    const ports = handle('acme', 'north');
    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_CONNECTION);
    const error = await refused(ports.forward(request));
    expect(error).toMatchObject({ name: 'PortForwardError', code: 'RESOURCE_LIMIT', limit: MAX_FORWARDS_PER_CONNECTION, message: FULL.connection });
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_CONNECTION);
    expect(reveal).toHaveBeenCalledTimes(MAX_FORWARDS_PER_CONNECTION);
  });

  it('are counted from the call, while the networker is still answering: a thousand asked at once end at the cap, with exactly the cap started and the rest refused', async () => {
    const { handle, start, slow, settleAll } = windowOf();
    slow();
    const ports = handle('acme', 'north');
    const asked = Array.from({ length: 1000 }, async () => ports.forward(request));
    // Nothing has been answered: the cap is reached by the places taken at the calls.
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_CONNECTION);
    settleAll();
    const outcomes = await Promise.allSettled(asked);
    expect(outcomes.filter(fulfilled)).toHaveLength(MAX_FORWARDS_PER_CONNECTION);
    const refusals = refusalsOf(outcomes);
    expect(refusals).toHaveLength(1000 - MAX_FORWARDS_PER_CONNECTION);
    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(PortForwardError);
      expect(refusal).toMatchObject({ code: 'RESOURCE_LIMIT', limit: MAX_FORWARDS_PER_CONNECTION, message: FULL.connection });
    }

    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_CONNECTION);
  });

  it('end at the cap when a thousand are asked twenty at a time, each batch with the networker still answering the one before: exactly the cap started', async () => {
    const { handle, start, slow, settleAll } = windowOf();
    slow();
    const ports = handle('acme', 'north');
    const outcomes: Array<PromiseSettledResult<unknown>> = [];
    for (let batch = 0; batch < 50; batch += 1) {
      const asked = Array.from({ length: 20 }, async () => ports.forward(request));
      settleAll();
      outcomes.push(...(await Promise.allSettled(asked)));
    }

    expect(outcomes).toHaveLength(1000);
    expect(outcomes.filter(fulfilled)).toHaveLength(MAX_FORWARDS_PER_CONNECTION);
    expect(refusalsOf(outcomes).every((refusal) => refusal instanceof PortForwardError && refusal.code === 'RESOURCE_LIMIT')).toBe(true);
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_CONNECTION);
  });

  it('stay at the cap after a thousand were asked: the count is the cap, not more and not less, so one stopped is one more that may be asked', async () => {
    const { handle, start, slow, settleAll } = windowOf();
    slow();
    const ports = handle('acme', 'north');
    const asked = Array.from({ length: 1000 }, async () => ports.forward(request));
    settleAll();
    const answers = answersOf(await Promise.allSettled(asked));
    expect(answers).toHaveLength(MAX_FORWARDS_PER_CONNECTION);
    await refused(ports.forward(request));
    await at(answers, 0).stop();
    // Exactly one place is free: one call starts, and the next is refused.
    const again = [ports.forward(request), ports.forward(request)];
    settleAll();
    const outcomes = await Promise.allSettled(again);
    expect(outcomes.map((settled) => settled.status)).toEqual(['fulfilled', 'rejected']);
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_CONNECTION + 1);
  });

  it('leave nothing counted when every one is stopped: the whole cap is there again, and nothing listens', async () => {
    const { handle, start, world } = windowOf();
    const ports = handle('acme', 'north');
    const first = await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    await Promise.all(first.map(async (answer) => answer.stop()));
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
    const second = await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    expect(second).toHaveLength(MAX_FORWARDS_PER_CONNECTION);
    expect(start).toHaveBeenCalledTimes(2 * MAX_FORWARDS_PER_CONNECTION);
    await refused(ports.forward(request));
  });

  it('are those of one plugin in one connection: a full connection leaves every other connection and plugin as it was', async () => {
    const { handle } = windowOf();
    await forwardTimes(handle('acme', 'north'), MAX_FORWARDS_PER_CONNECTION);
    await refused(handle('acme', 'north').forward(request));
    await starts(handle('acme', 'south'));
    await starts(handle('beta', 'north'));
  });
});

describe('the forwards a window may hold', () => {
  it('are at most the cap, in all its plugins and connections: the refusal says the window\'s number, in words of its own', async () => {
    const { handle, start } = windowOf();
    await forwardTimes(handle('acme', 'north'), MAX_FORWARDS_PER_CONNECTION);
    await forwardTimes(handle('beta', 'south'), MAX_FORWARDS_PER_WINDOW - MAX_FORWARDS_PER_CONNECTION);
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_WINDOW);
    const error = await refused(handle('acme', 'south').forward(request));
    expect(error).toMatchObject({ name: 'PortForwardError', code: 'RESOURCE_LIMIT', limit: MAX_FORWARDS_PER_WINDOW, message: FULL.window });
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_WINDOW);
  });

  it('say the connection\'s number when the connection is full as well: the narrower cap is the one a person can do something about', async () => {
    const { handle } = windowOf();
    await forwardTimes(handle('acme', 'north'), MAX_FORWARDS_PER_CONNECTION);
    await forwardTimes(handle('beta', 'south'), MAX_FORWARDS_PER_WINDOW - MAX_FORWARDS_PER_CONNECTION);
    const error = await refused(handle('acme', 'north').forward(request));
    expect(error).toMatchObject({ code: 'RESOURCE_LIMIT', limit: MAX_FORWARDS_PER_CONNECTION, message: FULL.connection });
  });

  it('are counted in flight as well: a thousand asked at once across plugins end at the window\'s cap', async () => {
    const { handle, start, slow, settleAll } = windowOf();
    slow();
    const handles = [handle('acme', 'north'), handle('acme', 'south'), handle('beta', 'north'), handle('beta', 'south')];
    const asked = Array.from({ length: 1000 }, async (_, one) => at(handles, one % handles.length).forward(request));
    // Four connections may hold 64 each, which is more than the window may.
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_WINDOW);
    settleAll();
    const outcomes = await Promise.allSettled(asked);
    expect(outcomes.filter(fulfilled)).toHaveLength(MAX_FORWARDS_PER_WINDOW);
    expect(refusalsOf(outcomes).every((refusal) => refusal instanceof PortForwardError && refusal.code === 'RESOURCE_LIMIT')).toBe(true);
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_WINDOW);
  });

  it('give a place back to every connection when one forward is stopped', async () => {
    const { handle } = windowOf();
    const kept = await forwardTimes(handle('acme', 'north'), MAX_FORWARDS_PER_CONNECTION);
    await forwardTimes(handle('beta', 'south'), MAX_FORWARDS_PER_WINDOW - MAX_FORWARDS_PER_CONNECTION);
    await refused(handle('acme', 'south').forward(request));
    await at(kept, 0).stop();
    await starts(handle('acme', 'south'));
    await refused(handle('acme', 'south').forward(request));
  });
});

describe('a place', () => {
  it('is given back when the host refuses the start: the forward did not start, so it is not counted', async () => {
    const { handle, start } = windowOf();
    const ports = handle('acme', 'north');
    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION - 1);
    start.mockImplementationOnce(async () => Promise.reject(new Error('the host did not answer')));
    await refused(ports.forward(request));
    await starts(ports);
    await refused(ports.forward(request));
  });

  it.each([
    ['no forward', async (): Promise<PortForwardStarted> => Promise.resolve(null)],
    ['a forward with no id', async (): Promise<PortForwardStarted> => Promise.resolve({ id: '', local_port: 41_234 })],
  ])('is given back when the host answers %s: there is no forward to count', async (_name, answer) => {
    const { handle, start } = windowOf();
    const ports = handle('acme', 'north');
    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION - 1);
    start.mockImplementationOnce(answer);
    await refused(ports.forward(request));
    await starts(ports);
  });

  it('is given back when the typed start throws before it asks the host', async () => {
    const { handle, start } = windowOf();
    const ports = handle('acme', 'north');
    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION - 1);
    start.mockImplementationOnce(() => {
      throw new RangeError('Request JSON byte limit');
    });
    await refused(ports.forward(request));
    await starts(ports);
  });

  it('is given back for a forward the host started without a port and the window ended: it is stopped, so it is not counted', async () => {
    const { handle, start, stop } = windowOf();
    const ports = handle('acme', 'north');
    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION - 1);
    start.mockImplementationOnce(async () => Promise.resolve({ id: 'portless', local_port: 0 }));
    await refused(ports.forward(request));
    expect(stop).toHaveBeenCalledWith('portless');
    await starts(ports);
  });

  it('is kept for a forward the host started without a port and the window could not end: it may be running, so it is counted until the host says it is closed', async () => {
    const { handle, start, stop, world } = windowOf();
    const ports = handle('acme', 'north');
    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION - 1);
    start.mockImplementationOnce(async () => Promise.resolve({ id: 'portless', local_port: 0 }));
    stop.mockImplementationOnce(async () => Promise.reject(new Error('the plugin did not answer')));
    await refused(ports.forward(request));
    await refused(ports.forward(request));
    world.closed('portless');
    await starts(ports);
  });

  it('is given back when the page stops the forward, once: a second stop of the same answer gives back nothing more', async () => {
    const { handle } = windowOf();
    const ports = handle('acme', 'north');
    const answers = await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    await at(answers, 0).stop();
    await at(answers, 0).stop();
    await starts(ports);
    await refused(ports.forward(request));
  });

  it('is given back when the page stops a forward that the host no longer has: it is not running, which is all a caller wants', async () => {
    const { handle, stop } = windowOf();
    const ports = handle('acme', 'north');
    const answers = await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    stop.mockImplementationOnce(async () => Promise.reject(GONE));
    await at(answers, 0).stop();
    await starts(ports);
    await refused(ports.forward(request));
  });

  it('is kept when the host refuses to close the forward: it may still be running, and it is counted until the host says it is closed', async () => {
    const { handle, stop, world } = windowOf();
    const ports = handle('acme', 'north');
    const answers = await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    stop.mockImplementationOnce(async () => Promise.reject(new Error('the plugin did not answer')));
    await refused(at(answers, 0).stop());
    await refused(ports.forward(request));
    world.closed(at(answers, 0).sessionId);
    await starts(ports);
    await refused(ports.forward(request));
  });

  it('is given back when the host says the forward is closed, by whoever closed it: the person in the Ports tool, or another window', async () => {
    const { handle, world } = windowOf();
    const ports = handle('acme', 'north');
    const answers = await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    world.closed('a-forward-this-window-did-not-start');
    await refused(ports.forward(request));
    world.closed(at(answers, 5).sessionId);
    await starts(ports);
    await refused(ports.forward(request));
  });

  it('is given back once for a forward that the page stopped and the host then says is closed: the two are one end', async () => {
    const { handle, world } = windowOf();
    const ports = handle('acme', 'north');
    const answers = await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    await at(answers, 0).stop();
    world.closed(at(answers, 0).sessionId);
    await starts(ports);
    await refused(ports.forward(request));
  });

  it('is given back at once for a forward that the host closed before it answered the start: the event can come first', async () => {
    const { handle, slow, settleAll, world } = windowOf();
    slow();
    const ports = handle('acme', 'north');
    const pending = ports.forward(request);
    // The host's first answer is the forward `forward-1`, and it says it is closed before the call has heard of it.
    world.closed('forward-1');
    settleAll();
    await pending;
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
    slow(false);
    expect(await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION)).toHaveLength(MAX_FORWARDS_PER_CONNECTION);
  });

  it('is given back for every forward of a plugin that stopped, in every connection: its tunnels went with it, and the host says nothing of it', async () => {
    const { handle, world } = windowOf();
    await forwardTimes(handle('acme', 'north'), MAX_FORWARDS_PER_CONNECTION);
    await forwardTimes(handle('acme', 'south'), 3);
    await forwardTimes(handle('beta', 'north'), 5);
    world.stopped('acme');
    // The plugin runs again: its places are free, and the other plugin keeps the places it has.
    await forwardTimes(handle('acme', 'north'), MAX_FORWARDS_PER_CONNECTION);
    await refused(handle('acme', 'north').forward(request));
    await forwardTimes(handle('beta', 'north'), MAX_FORWARDS_PER_CONNECTION - 5);
    await refused(handle('beta', 'north').forward(request));
  });

  it('is given back for a start that was under way when its plugin stopped: the call that is answered after it holds nothing', async () => {
    const { handle, slow, settleAll, world } = windowOf();
    slow();
    const ports = handle('acme', 'north');
    const pending = ports.forward(request);
    world.stopped('acme');
    settleAll();
    await pending;
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
  });
});

describe('what a window listens to for its count', () => {
  it('is nothing while it holds no forward: no listener on the host\'s closed events and none on the plugins, until a forward is counted', () => {
    const { world } = windowOf();
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
    expect(world.subscribed()).toEqual({ closed: 0, plugins: 0 });
  });

  it('is one listener on each, from the first forward counted, and no more for the forwards after it', async () => {
    const { handle, slow, settleAll, world } = windowOf();
    slow();
    const first = handle('acme', 'north').forward(request);
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    const second = handle('beta', 'south').forward(request);
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    expect(world.subscribed()).toEqual({ closed: 1, plugins: 1 });
    settleAll();
    await Promise.all([first, second]);
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
  });

  it('is nothing again when the last forward is stopped, and one again for the next', async () => {
    const { handle, world } = windowOf();
    const ports = handle('acme', 'north');
    const answers = await forwardTimes(ports, 2);
    await at(answers, 0).stop();
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    await at(answers, 1).stop();
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
    await ports.forward(request);
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    expect(world.subscribed()).toEqual({ closed: 2, plugins: 2 });
  });

  it('is nothing again when the start that held the only place fails', async () => {
    const { handle, start, world } = windowOf();
    start.mockImplementationOnce(async () => Promise.reject(new Error('the host did not answer')));
    await refused(handle('acme', 'north').forward(request));
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
  });

  it('is nothing again when the host says the last forward is closed', async () => {
    const { handle, world } = windowOf();
    const answers = await forwardTimes(handle('acme', 'north'), 1);
    world.closed(at(answers, 0).sessionId);
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
  });

  it('is nothing for a call that is refused before it takes a place: outside a user action, over a bound, or over the cap', async () => {
    const { handle, acting, world } = windowOf();
    const ports = handle('acme', 'north');
    acting(false);
    await refused(ports.forward(request));
    acting(true);
    await refused(ports.forward({ ...request, resourceId: 'x'.repeat(2000) }));
    expect(world.subscribed()).toEqual({ closed: 0, plugins: 0 });
    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    await refused(ports.forward(request));
    expect(world.subscribed()).toEqual({ closed: 1, plugins: 1 });
  });
});

describe('a call that is refused before it takes a place', () => {
  it('holds nothing: a thousand outside a user action, and a thousand over a bound, leave the whole cap there', async () => {
    const { handle, acting, start } = windowOf();
    const ports = handle('acme', 'north');
    acting(false);
    for (let one = 0; one < 1000; one += 1) {
      await refused(ports.forward(request));
    }

    acting(true);
    for (let one = 0; one < 1000; one += 1) {
      await refused(ports.forward({ ...request, resourceId: 'x'.repeat(2000) }));
    }

    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    expect(start).toHaveBeenCalledTimes(MAX_FORWARDS_PER_CONNECTION);
  });

  it('is refused for what is wrong with it before the cap is read: a full connection says an invalid request is invalid, and a call outside a user action is forbidden', async () => {
    const { handle, acting } = windowOf();
    const ports = handle('acme', 'north');
    await forwardTimes(ports, MAX_FORWARDS_PER_CONNECTION);
    expect(await refused(ports.forward({ ...request, remotePort: 0 }))).toMatchObject({ code: 'INVALID_REQUEST' });
    acting(false);
    expect(await refused(ports.forward(request))).toMatchObject({ code: 'FORBIDDEN' });
  });
});
