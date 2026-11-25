import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ConnectionStateV1, ConnectionsHostV1 } from '../contract/v1';
import type { ConnectionState } from './connections';
import { connectionsHostsOf } from './connectionsHost';
import { connection, connectionStore, hostConnections } from './homeTesting';

// What a custom page asks of the window about its plugin's connections (KL2): the window's own store, words and actions for one plugin, handed over as one external store and three functions. The window is a fake store and fake actions: no runtime, no host.

// The two states the contract and the window say are one list: a state added to one and not to the other is a compile error here.
expectTypeOf<ConnectionStateV1>().toEqualTypeOf<ConnectionState>();

const north = connection('acme', 'north-1', 'north', 'connected', { detail: 'Acme · region one' });
const south = connection('acme', 'south-2', 'south', 'unauthorized', { reason: 'The connection needs you to sign in.' });
const other = connection('other', 'east-3', 'east');

function mount(connections = [north, south, other], over: Parameters<typeof connectionStore>[1] = {}) {
  const store = connectionStore(connections, over);
  const host = hostConnections(store);
  const handle = connectionsHostsOf(host)('acme');
  return { store, host, handle };
}

describe('the view of a plugin\'s connections', () => {
  it('lists the plugin\'s connections and no other\'s, each with the window\'s own words: the key to open it by, the name to read, the description, the state, its word and the role of its glyph', () => {
    const { handle } = mount();

    expect(handle.getSnapshot()).toEqual({
      loaded: true,
      failed: false,
      connections: [
        { key: 'north-1', name: 'north', description: 'Acme · region one', state: 'connected', word: 'Connected', role: 'healthy', reason: undefined },
        { key: 'south-2', name: 'south', description: undefined, state: 'unauthorized', word: 'Needs sign-in', role: 'attention', reason: 'The connection needs you to sign in.' },
      ],
    });
  });

  it('says it has read nothing, and that a read failed, as the window says it: an empty list is not yet "no connections"', () => {
    const { handle, store } = mount([], { loaded: false });
    expect(handle.getSnapshot()).toMatchObject({ loaded: false, failed: false, connections: [] });

    store.set({ loaded: true, failed: true, connections: [north] });
    expect(handle.getSnapshot()).toMatchObject({ loaded: true, failed: true, connections: [{ key: 'north-1' }] });
  });

  it('is the same object until something of this plugin\'s changed, so a change of another plugin\'s connection draws none of its pages, and the one connection that changed is the only new one', () => {
    const { handle, store } = mount();
    const before = handle.getSnapshot();

    store.set({ connections: [north, south, connection('other', 'east-3', 'east', 'connecting')] });
    expect(handle.getSnapshot()).toBe(before);

    const changed = connection('acme', 'south-2', 'south', 'connecting');
    store.set({ connections: [north, changed, other] });
    const after = handle.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.connections[0]).toBe(before.connections[0]);
    expect(after.connections[1]).toMatchObject({ state: 'connecting', word: 'Connecting…', role: 'progress' });
  });

  it('is frozen: a page that holds it cannot change what another page reads', () => {
    const { handle } = mount();
    const view = handle.getSnapshot();

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.connections)).toBe(true);
    expect(Object.isFrozen(view.connections[0])).toBe(true);
    expect(Object.isFrozen(handle)).toBe(true);
  });
});

describe('subscribe', () => {
  it('calls the listener when this plugin\'s view changed and for nothing else: not for another plugin\'s connection, not for a read that changed nothing', () => {
    const { handle, store } = mount();
    const listener = vi.fn();
    handle.subscribe(listener);

    store.set({ connections: [north, south, connection('other', 'east-3', 'east', 'failed')] });
    store.set({});
    expect(listener).not.toHaveBeenCalled();

    store.set({ connections: [north, connection('acme', 'south-2', 'south', 'connected'), other] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops when it is stopped, and each subscription is its own', () => {
    const { handle, store } = mount();
    const first = vi.fn();
    const second = vi.fn();
    const stop = handle.subscribe(first);
    handle.subscribe(second);

    stop();
    store.set({ connections: [north] });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('open and refresh', () => {
  it('opens the connection of THIS plugin the way a press on one of Home\'s rows does: the window starts it first and opens its home, in a smart open, or in a new tab when asked', async () => {
    const { handle, host } = mount();

    await expect(handle.open('north-1')).resolves.toEqual({ ok: true });
    await handle.open('south-2', { newTab: true });
    await handle.open('south-2', { newTab: false });

    expect(host.go.mock.calls).toEqual([
      ['acme', 'north-1', { how: 'smart', source: 'landing' }],
      ['acme', 'south-2', { how: 'new', source: 'landing' }],
      ['acme', 'south-2', { how: 'smart', source: 'landing' }],
    ]);
  });

  it('answers why when the window could not, in its own sentence, and never rejects', async () => {
    const { handle, host } = mount();
    host.go.mockResolvedValueOnce({ ok: false, reason: 'The connection needs you to sign in.' });

    await expect(handle.open('south-2')).resolves.toEqual({ ok: false, reason: 'The connection needs you to sign in.' });
  });

  it('reads the list again when asked', async () => {
    const { handle, store } = mount();

    await handle.refresh();

    expect(store.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('connectionsHostsOf', () => {
  it('gives the same handle for a plugin whenever it is asked: a page\'s context holds it, and a context that is the same object draws nothing again', () => {
    const hosts = connectionsHostsOf(hostConnections(connectionStore([north])));

    expect(hosts('acme')).toBe(hosts('acme'));
    expect(hosts('acme')).not.toBe(hosts('other'));
  });

  it('is a handle that says no connection and opens none in a window with no connection data: it does not throw, and a page that reads it draws what it draws for no connection', async () => {
    const handle: ConnectionsHostV1 = connectionsHostsOf(undefined)('acme');

    expect(handle.getSnapshot()).toEqual({ loaded: true, failed: false, connections: [] });
    expect(handle.getSnapshot()).toBe(handle.getSnapshot());
    expect(handle.subscribe(() => undefined)).toBeTypeOf('function');
    await expect(handle.open('north-1')).resolves.toEqual({ ok: false, reason: 'This window has no connections to open.' });
    await expect(handle.refresh()).resolves.toBeUndefined();
  });
});
