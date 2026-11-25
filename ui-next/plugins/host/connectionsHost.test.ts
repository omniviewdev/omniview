import { describe, expect, it } from 'vitest';
import { connectionsHostsOf } from './connectionsHost';
import { connection, connectionStore, hostConnections } from './homeTesting';

// What a custom page reads of its plugin's connections (KL2): the window's own list cut to one plugin, and what opening and reading again ask of the window. The window is a fake store and fake actions.

const north = connection('acme', 'north-1', 'north', 'connected', { detail: 'Acme · region one' });
const south = connection('acme', 'south-2', 'south', 'unauthorized', { reason: 'The connection needs you to sign in.' });
const east = connection('other', 'east-3', 'east');

function mount() {
  const store = connectionStore([north, south, east]);
  const host = hostConnections(store);
  return { store, host, handle: connectionsHostsOf(host)('acme') };
}

describe('the view of a plugin\'s connections', () => {
  it('lists this plugin\'s connections in the window\'s words and is the same object until one of them changes: another plugin\'s change draws nothing, and the connection that did not change is the one it was', () => {
    const { handle, store } = mount();
    const before = handle.getSnapshot();

    expect(before).toEqual({
      loaded: true,
      failed: false,
      connections: [
        { key: 'north-1', name: 'north', description: 'Acme · region one', state: 'connected', word: 'Connected', role: 'healthy', reason: undefined },
        { key: 'south-2', name: 'south', description: undefined, state: 'unauthorized', word: 'Needs sign-in', role: 'attention', reason: 'The connection needs you to sign in.' },
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
});

describe('open and refresh', () => {
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

  it('reads the list again when asked', async () => {
    const { handle, store } = mount();

    await handle.refresh();

    expect(store.refresh).toHaveBeenCalledTimes(1);
  });
});
