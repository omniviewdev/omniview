import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogStreams, createPanelStore, LOGS_TOOL, type LogStreams, type PanelStore } from '../../shell';
import { fakeFeed } from '../../shell/panel/logs/testing';
import type { LogTargetV1, PanelHostV1 } from '../contract/v1';
import { panelHostsOf } from './panelHost';
import type { PortForwardStart, PortForwardStop, PortForwarding } from './portForward';
import { ledgerWorld } from './portTesting';

// What a plugin's `ctx.panel` is: the host's Logs registry, bound to the plugin that holds it. The registry is tested in ui-next/shell/panel/logs; what is under test here is the plugin's side of the
// handle: a target in the plugin's words (a `RouteV1`, no plugin id) becomes the host's descriptor in the plugin's name, and the plugin gets back a session it may close.

type Harness = { readonly store: PanelStore; readonly streams: LogStreams; readonly hostOf: (plugin: string, connection?: string) => PanelHostV1 };

function harness(forwarding?: PortForwarding): Harness {
  const store = createPanelStore();
  store.registerTool(LOGS_TOOL);
  store.syncPlugins([
    { id: 'acme', tools: [] },
    { id: 'beta', tools: [] },
  ]);
  const streams = createLogStreams(store);
  streams.attach();
  return { store, streams, hostOf: panelHostsOf(streams, forwarding) };
}

/** A port-forward service for a window: a networker that starts forward after forward and stops what it is asked to, the Ports tool, a window in the middle of a user action, and the feeds the window's count listens to. */
const forwarding = () => {
  const world = ledgerWorld();
  return {
    start: vi.fn<PortForwardStart>(async () => Promise.resolve({ id: 'forward-1', local_port: 41_234 })),
    stop: vi.fn<PortForwardStop>(async () => Promise.resolve(undefined)),
    revealPortsTool: vi.fn<() => void>(),
    userActivation: () => true,
    onClosed: world.deps.onClosed,
    plugins: world.deps.plugins,
    world,
  } satisfies PortForwarding & { readonly world: unknown };
};

const target = (patch: Partial<LogTargetV1> = {}): LogTargetV1 => ({ id: 'item/orders-api/app', title: 'orders-api/app', scope: 'north', open: () => fakeFeed(), ...patch });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the handle a plugin gets (`ctx.panel`)', () => {
  it('is one handle for a plugin, however often the host asks: a context that holds it stays the same object', () => {
    const { hostOf } = harness();
    expect(hostOf('acme')).toBe(hostOf('acme'));
    expect(hostOf('acme')).not.toBe(hostOf('beta'));
  });

  it('opens a Logs session in the plugin\'s name, on the target it handed over', () => {
    const { store, hostOf } = harness();
    const opened = hostOf('acme').logs.open(target());
    expect(opened?.id).toBeDefined();
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north' });
  });

  it('cannot open a session in another plugin\'s name, whatever the target says: the handle knows whose it is', () => {
    const { store, hostOf } = harness();
    const forged: LogTargetV1 = Object.assign(target(), { plugin: 'beta' });
    const opened = hostOf('acme').logs.open(forged);
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.plugin).toBe('acme');
  });

  it('writes the resource\'s route as a route of the tab model in the plugin: its page, its connection and its parameters', () => {
    const { streams, hostOf } = harness();
    const opened = hostOf('acme').logs.open(
      target({ resource: { label: 'Item orders-api', kind: 'Item', icon: 'layers', route: { page: 'item', connection: 'north-1', params: { name: 'orders-api', group: 'north-yard' } } } }),
    );
    expect(streams.recordOf(opened?.id ?? '')?.resource).toEqual({
      label: 'Item orders-api',
      kind: 'Item',
      icon: 'layers',
      route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api', group: 'north-yard', connection: 'north-1' } },
    });
  });

  it('hands back a session that closes: its tab goes, and the stream with it', () => {
    const { store, hostOf } = harness();
    const feed = fakeFeed();
    const opened = hostOf('acme').logs.open(target({ open: () => feed }));
    opened?.close();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(feed.closed()).toBe(1);
  });

  it('answers `undefined`, and the console says why, when the host could not open it', () => {
    const { store, hostOf } = harness();
    store.syncPlugins([{ id: 'beta', tools: [] }]);
    expect(hostOf('acme').logs.open(target())).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('answers `undefined` for a target that is not an object, as it does for any that is not well formed, and does not throw into the plugin', () => {
    const { hostOf } = harness();
    expect(hostOf('acme').logs.open(undefined as unknown as LogTargetV1)).toBeUndefined();
    expect(hostOf('acme').logs.open(null as unknown as LogTargetV1)).toBeUndefined();
    expect(hostOf('acme').logs.open({} as LogTargetV1)).toBeUndefined();
  });
});

describe('a target that is not well formed', () => {
  it('does not make the handle throw for a resource that is not an object: the session opens with no resource, and what the registry must refuse it still refuses', () => {
    const { store, hostOf } = harness();
    const opened = hostOf('acme').logs.open({ ...target(), resource: null } as unknown as LogTargetV1);
    expect(opened?.id).toBeDefined();
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ tool: 'logs', plugin: 'acme' });
  });
});

// PF1: the handle also says how a page forwards a port. It is bound to the plugin AND to the connection the page is read in, because the host fills both in (`portForward.test.ts` is what a forward does); the networker and
// the Ports tool are fakes. A page that is read in a connection has the member. A page that is read in none, and a palette command (which runs from the palette and not from a page), have not: a member that is there and can
// never work is worse than one that is absent, and a plugin tests for it as it does for a host that predates it.
describe('the ports member of the handle (PF1)', () => {
  const request = { resourceId: 'alpha', resourceKey: 'widgets', remotePort: 8080 };

  /** The ports member of a handle, which a test that goes on to call it has checked is there. */
  function portsMember(handle: PanelHostV1): NonNullable<PanelHostV1['ports']> {
    const { ports } = handle;
    if (ports === undefined) {
      throw new Error('the handle has no ports member');
    }

    return ports;
  }

  it('is absent where the window has no port-forward service: the handle of a host that predates it, which a plugin tests for', () => {
    const { hostOf } = harness();
    expect(hostOf('acme', 'north').ports).toBeUndefined();
    expect('ports' in hostOf('acme', 'north')).toBe(false);
    expect(hostOf('acme', 'north').logs.open).toBeTypeOf('function');
  });

  it('is there for a page that is read in a connection, where the window has a service', () => {
    const { hostOf } = harness(forwarding());
    expect(hostOf('acme', 'north').ports?.forward).toBeTypeOf('function');
    expect(hostOf('beta', 'south').ports?.forward).toBeTypeOf('function');
  });

  it.each([
    ['no connection at all (a page that is read in none, and the handle of a palette command)', undefined],
    ['an empty connection', ''],
  ])('is absent from a handle made for %s: nothing says which connection to forward in, and a member that always refuses is worse than none', (_name, connection) => {
    const { hostOf } = harness(forwarding());
    const handle = hostOf('acme', connection);
    expect(handle.ports).toBeUndefined();
    expect('ports' in handle).toBe(false);
    expect(Object.keys(handle)).toEqual(['logs']);
    expect(handle.logs.open).toBeTypeOf('function');
  });

  it('asks the networker nothing and shows nothing, for a handle that has no connection: there is nothing to call', () => {
    const forward = forwarding();
    const { hostOf } = harness(forward);
    hostOf('acme');
    hostOf('acme', '');
    expect(forward.start).not.toHaveBeenCalled();
    expect(forward.stop).not.toHaveBeenCalled();
    expect(forward.revealPortsTool).not.toHaveBeenCalled();
  });

  it('is one handle for a plugin in a connection, however often the host asks: a context that holds it stays the same object', () => {
    const { hostOf } = harness(forwarding());
    expect(hostOf('acme', 'north')).toBe(hostOf('acme', 'north'));
    expect(hostOf('acme', 'north')).not.toBe(hostOf('acme', 'south'));
    expect(hostOf('acme', 'north')).not.toBe(hostOf('beta', 'north'));
  });

  it('is one handle for a plugin in no connection, which an empty connection is: nothing says which one a page is read in', () => {
    const { hostOf } = harness(forwarding());
    expect(hostOf('acme')).toBe(hostOf('acme'));
    expect(hostOf('acme')).toBe(hostOf('acme', ''));
    expect(hostOf('acme')).not.toBe(hostOf('acme', 'north'));
  });

  it('keeps one Logs member for a plugin whatever the connection: a hook that depends on it is not told it changed when the page moves to another connection', () => {
    const { hostOf } = harness(forwarding());
    expect(hostOf('acme', 'north').logs).toBe(hostOf('acme', 'south').logs);
    expect(hostOf('acme', 'north').logs).toBe(hostOf('acme').logs);
    expect(hostOf('acme', 'north').logs).not.toBe(hostOf('beta', 'north').logs);
  });

  it('opens Logs sessions as it always did, from a handle that has the ports member', () => {
    const { store, hostOf } = harness(forwarding());
    const opened = hostOf('acme', 'north').logs.open(target());
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ tool: 'logs', plugin: 'acme' });
  });

  it('forwards in the plugin and the connection of the handle it is called on, and in no other', async () => {
    const forward = forwarding();
    const { hostOf } = harness(forward);
    await hostOf('acme', 'north').ports?.forward(request);
    await hostOf('beta', 'south').ports?.forward(request);
    await hostOf('acme', 'north').ports?.forward(request);
    expect(forward.start.mock.calls.map(([plugin, connection]) => [plugin, connection])).toEqual([
      ['acme', 'north'],
      ['beta', 'south'],
      ['acme', 'north'],
    ]);
  });

  it('shows the Ports tool once for a forward that started, and for a handle of any plugin', async () => {
    const forward = forwarding();
    const { hostOf } = harness(forward);
    await hostOf('acme', 'north').ports?.forward(request);
    expect(forward.revealPortsTool).toHaveBeenCalledTimes(1);
    await hostOf('beta', 'south').ports?.forward(request);
    expect(forward.revealPortsTool).toHaveBeenCalledTimes(2);
  });

  it('answers a forward whose stop closes that forward through the window\'s networker, by its id', async () => {
    const forward = forwarding();
    const { hostOf } = harness(forward);
    const answer = await portsMember(hostOf('acme', 'north')).forward(request);
    expect(answer).toMatchObject({ sessionId: 'forward-1', localPort: 41_234 });
    expect('localHost' in answer).toBe(false);
    expect(forward.stop).not.toHaveBeenCalled();
    await answer.stop();
    expect(forward.stop).toHaveBeenCalledTimes(1);
    expect(forward.stop).toHaveBeenCalledWith('forward-1');
  });
});

// PF2: the count of the forwards a window has started (`portLedger.ts`) is the window's, made once with the handles and shared by every one of them: the caps on what a plugin may hold in a connection and on what the window may
// hold are what that one count says, whichever plugin and connection a handle is for. Another window has handles of its own and a count of its own: across windows the host has no owner of a forward.
describe('the count of forwards of a window (PF2)', () => {
  const request = { resourceId: 'alpha', resourceKey: 'widgets', remotePort: 8080 };

  /** A service whose networker answers each start with a forward of its own. */
  function numbering() {
    const forward = forwarding();
    let issued = 0;
    forward.start.mockImplementation(async () => {
      issued += 1;
      return Promise.resolve({ id: `forward-${String(issued)}`, local_port: 40_000 + issued });
    });
    return forward;
  }

  async function forwardTimes(handle: PanelHostV1, count: number): Promise<void> {
    for (let one = 0; one < count; one += 1) {
      await handle.ports?.forward(request);
    }
  }

  it('is shared by every handle of the window: forwards in two connections of one plugin and in another plugin count towards one cap on the window', async () => {
    const forward = numbering();
    const { hostOf } = harness(forward);
    await forwardTimes(hostOf('acme', 'north'), 64);
    await forwardTimes(hostOf('acme', 'south'), 64);
    await expect(hostOf('beta', 'east').ports?.forward(request)).rejects.toMatchObject({ name: 'PortForwardError', code: 'RESOURCE_LIMIT', limit: 128 });
    expect(forward.start).toHaveBeenCalledTimes(128);
  });

  it('is shared by a handle that is made after the others have forwarded: it is the window\'s count it joins, not a new one', async () => {
    const forward = numbering();
    const { hostOf } = harness(forward);
    await forwardTimes(hostOf('acme', 'north'), 64);
    await forwardTimes(hostOf('beta', 'south'), 64);
    await expect(hostOf('gamma', 'east').ports?.forward(request)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', limit: 128 });
  });

  it('holds a plugin to its cap in each connection on its own: the same handle asks the same count', async () => {
    const forward = numbering();
    const { hostOf } = harness(forward);
    await forwardTimes(hostOf('acme', 'north'), 64);
    await expect(hostOf('acme', 'north').ports?.forward(request)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', limit: 64 });
    await expect(hostOf('acme', 'south').ports?.forward(request)).resolves.toMatchObject({ localPort: expect.any(Number) });
  });

  it('is a window\'s own: another window has handles and a count of its own, and the host has no owner of a forward to join them', async () => {
    const first = harness(numbering());
    const second = harness(numbering());
    await forwardTimes(first.hostOf('acme', 'north'), 64);
    await expect(first.hostOf('acme', 'north').ports?.forward(request)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(second.hostOf('acme', 'north').ports?.forward(request)).resolves.toMatchObject({ localPort: expect.any(Number) });
  });

  it('listens to nothing until a handle has forwarded: making handles, and reading them, costs the window no listener', () => {
    const forward = numbering();
    const { hostOf } = harness(forward);
    hostOf('acme', 'north');
    hostOf('beta');
    expect(forward.world.listening()).toEqual({ closed: 0, plugins: 0 });
    expect(forward.world.subscribed()).toEqual({ closed: 0, plugins: 0 });
  });
});

// PF1, N3 of the review: a handle is the plugin's and the connection's, and every page of that plugin in that connection is given the same one. A page that replaced a member would replace it for all of them, so the handle
// and each member are frozen.
describe('a handle a page is given cannot be changed by the page (PF1)', () => {
  it('is frozen, and so is each member it holds', () => {
    const { hostOf } = harness(forwarding());
    const handle = hostOf('acme', 'north');
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(handle.logs)).toBe(true);
    expect(Object.isFrozen(handle.ports)).toBe(true);
  });

  it('is frozen where it has no ports member as well: the handle of no connection, and that of a window with no port-forward service', () => {
    const noConnection = harness(forwarding()).hostOf('acme');
    const noService = harness().hostOf('acme', 'north');
    for (const handle of [noConnection, noService]) {
      expect(Object.isFrozen(handle)).toBe(true);
      expect(Object.isFrozen(handle.logs)).toBe(true);
    }
  });

  it('keeps `ports.forward` as it was when a page tries to replace it, for the other pages that share the handle', async () => {
    const forward = forwarding();
    const { hostOf } = harness(forward);
    const handle = hostOf('acme', 'north');
    const original = handle.ports?.forward;
    expect(original).toBeTypeOf('function');

    // A page replaces the members one after the other. In a module (strict mode, as a plugin's bundle is) each of these throws; `Reflect.set` says the same without the throw.
    expect(Reflect.set(handle.ports ?? {}, 'forward', async () => Promise.resolve({ sessionId: 'pwned' }))).toBe(false);
    expect(Reflect.set(handle, 'ports', { forward: async () => Promise.resolve({ sessionId: 'pwned' }) })).toBe(false);
    expect(Reflect.set(handle.logs, 'open', () => undefined)).toBe(false);
    expect(Reflect.set(handle, 'logs', { open: () => undefined })).toBe(false);

    // Another page of the same plugin and connection is given the same handle, with the members it was made with.
    const other = hostOf('acme', 'north');
    expect(other).toBe(handle);
    expect(other.ports?.forward).toBe(original);
    await expect(other.ports?.forward({ resourceId: 'alpha', remotePort: 8080 })).resolves.toMatchObject({ sessionId: 'forward-1' });
    expect(forward.start).toHaveBeenCalledTimes(1);
  });

  it('keeps the Logs member of the plugin as it was, for the pages of every connection that share it', () => {
    const { store, hostOf } = harness(forwarding());
    const open = hostOf('acme', 'north').logs.open;
    expect(Reflect.set(hostOf('acme', 'north').logs, 'open', () => undefined)).toBe(false);
    expect(hostOf('acme', 'south').logs.open).toBe(open);
    const opened = hostOf('acme', 'south').logs.open(target());
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ tool: 'logs', plugin: 'acme' });
  });

  it('takes no new member: a page cannot add one that the other pages would find', () => {
    const { hostOf } = harness(forwarding());
    const handle = hostOf('acme', 'north');
    expect(Reflect.set(handle, 'extra', 1)).toBe(false);
    expect(Reflect.set(handle.ports ?? {}, 'list', () => [])).toBe(false);
    expect(Object.keys(handle)).toEqual(['logs', 'ports']);
    expect(Object.keys(handle.ports ?? {})).toEqual(['forward']);
  });

  it('cannot lose a member: a page cannot delete one either', () => {
    const { hostOf } = harness(forwarding());
    const handle = hostOf('acme', 'north');
    expect(Reflect.deleteProperty(handle, 'ports')).toBe(false);
    expect(Reflect.deleteProperty(handle.ports ?? {}, 'forward')).toBe(false);
    expect(handle.ports?.forward).toBeTypeOf('function');
  });
});
