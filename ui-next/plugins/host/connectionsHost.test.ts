import { describe, expect, it, vi } from 'vitest';
import type { ConnectionVerbs } from './connections';
import { createQuestions } from './connections/questions';
import { connectionsHostsOf } from './connectionsHost';
import { connection, connectionStore, hostConnections } from './homeTesting';

// What a custom page reads of its plugin's connections (KL2, KL4): the window's own list cut to one plugin, and what opening, starting, checking, stopping, removing and reading again ask of the window. The window is a fake store, fake actions and fake verbs.

const north = connection('acme', 'north-1', 'north', 'connected', { detail: 'Acme · region one' });
const south = connection('acme', 'south-2', 'south', 'unauthorized', { reason: 'The connection needs you to sign in.' });
const east = connection('other', 'east-3', 'east');

function fakeVerbs() {
  const worked = async () => Promise.resolve({ ok: true as const });
  return {
    connect: vi.fn<ConnectionVerbs['connect']>(worked),
    check: vi.fn<ConnectionVerbs['check']>(worked),
    disconnect: vi.fn<ConnectionVerbs['disconnect']>(worked),
    remove: vi.fn<ConnectionVerbs['remove']>(worked),
    refresh: vi.fn<ConnectionVerbs['refresh']>(async () => Promise.resolve()),
    questions: createQuestions(),
  };
}

function mount() {
  const store = connectionStore([north, south, east]);
  const host = hostConnections(store);
  const verbs = fakeVerbs();
  return { store, host, verbs, handle: connectionsHostsOf(host, verbs)('acme') };
}

describe('the view of a plugin\'s connections', () => {
  it('lists this plugin\'s connections in the window\'s words and is the same object until one of them changes: another plugin\'s change draws nothing, and the connection that did not change is the one it was', () => {
    const { handle, store } = mount();
    const before = handle.getSnapshot();

    expect(before).toEqual({
      loaded: true,
      failed: false,
      connections: [
        { key: 'north-1', name: 'north', description: 'Acme · region one', labels: {}, state: 'connected', word: 'Connected', role: 'healthy', reason: undefined },
        { key: 'south-2', name: 'south', description: undefined, labels: {}, state: 'unauthorized', word: 'Needs sign-in', role: 'attention', reason: 'The connection needs you to sign in.' },
      ],
    });

    store.set({ connections: [north, south, connection('other', 'east-3', 'east', 'failed')] });
    expect(handle.getSnapshot()).toBe(before);

    store.set({ connections: [north, connection('acme', 'south-2', 'south', 'connecting'), east] });
    const after = handle.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.connections[0]).toBe(before.connections[0]);
    expect(after.connections[1]).toMatchObject({ state: 'connecting', word: 'Connecting…', role: 'progress' });
  });

  it('tells the labels the plugin\'s backend put on a connection, frozen, and what the window is doing to it', () => {
    const labelled = connection('acme', 'north-1', 'north', 'connected', { labels: Object.freeze({ env: 'prod', team: 'core' }), busy: 'checking' });
    const handle = connectionsHostsOf(hostConnections(connectionStore([labelled])), fakeVerbs())('acme');

    const [told] = handle.getSnapshot().connections;

    expect(told).toMatchObject({ labels: { env: 'prod', team: 'core' }, busy: 'checking', state: 'connected' });
    expect(Object.isFrozen(told?.labels)).toBe(true);
  });
});

describe('open and the verbs', () => {
  it('opens a connection of this plugin the way Home\'s row does, in a new tab when asked, and answers what the window answered: done, or why not', async () => {
    const { handle, host } = mount();
    host.go.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: 'The connection needs you to sign in.' });

    await expect(handle.open('north-1')).resolves.toEqual({ ok: true });
    await handle.open('south-2', { newTab: true });
    await expect(handle.open('south-2')).resolves.toEqual({ ok: false, reason: 'The connection needs you to sign in.' });

    expect(host.go.mock.calls).toEqual([
      ['acme', 'north-1', { how: 'smart', source: 'landing' }],
      ['acme', 'south-2', { how: 'new', source: 'landing' }],
      ['acme', 'south-2', { how: 'smart', source: 'landing' }],
    ]);
  });

  it('makes every verb the plugin\'s own, whatever the key: a page asks for its plugin\'s connections and for no other plugin\'s, and says what the window answered', async () => {
    const { handle, verbs } = mount();
    verbs.remove.mockResolvedValueOnce({ ok: false, reason: 'This connection is not in the list.' });

    await handle.connect('north-1');
    await handle.check('north-1');
    await handle.disconnect('south-2');
    await expect(handle.remove('east-3')).resolves.toEqual({ ok: false, reason: 'This connection is not in the list.' });
    await handle.refresh();

    expect(verbs.connect).toHaveBeenCalledExactlyOnceWith('acme', 'north-1');
    expect(verbs.check).toHaveBeenCalledExactlyOnceWith('acme', 'north-1');
    expect(verbs.disconnect).toHaveBeenCalledExactlyOnceWith('acme', 'south-2');
    expect(verbs.remove).toHaveBeenCalledExactlyOnceWith('acme', 'east-3');
    expect(verbs.refresh).toHaveBeenCalledExactlyOnceWith('acme');
  });

  it('refuses every verb in words in a window with no connection data, and reads no connection', async () => {
    const handle = connectionsHostsOf(undefined, undefined)('acme');
    const refused = { ok: false, reason: 'This window has no connections.' };

    expect(handle.getSnapshot()).toEqual({ loaded: true, failed: false, connections: [] });
    await expect(handle.open('north-1')).resolves.toEqual(refused);
    for (const verb of ['connect', 'check', 'disconnect', 'remove'] as const) {
      await expect(handle[verb]('north-1'), verb).resolves.toEqual(refused);
    }
  });
});
