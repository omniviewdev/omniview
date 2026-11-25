import { describe, expect, it, vi } from 'vitest';
import { ConnectionNames } from './connectionName';
import type { ConnectionsState, ConnectionsStore } from './connections';
import { portNamesOf } from './portNames';

// What the Ports tool reads of the window to name a forward's connection: the connections the window lists (their names, which the host's own records give), and the names the window learned from the pages it drew. Never the connection's id:
// a connection that neither knows is nameless, and the table draws a dash.

type Entry = ConnectionsState['connections'][number];
const entry = (plugin: string, key: string, name: string): Entry => ({ plugin, key, name, state: 'connected', reason: undefined });

/** A connection store that answers what a test gives it, and counts who listens. */
function store(connections: readonly Entry[]) {
  let state: ConnectionsState = { loaded: true, failed: false, connections };
  const listeners = new Set<() => void>();
  const fake: Pick<ConnectionsStore, 'getSnapshot' | 'subscribe'> = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    fake,
    listeners: () => listeners.size,
    set: (next: readonly Entry[]) => {
      state = { ...state, connections: next };
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

describe('the name of a connection, for a forward', () => {
  it('is the name the window lists for the connection of that plugin', () => {
    const { fake } = store([entry('acme', 'conn-1', 'Staging'), entry('acme', 'conn-2', 'Production')]);
    const names = portNamesOf(fake, new ConnectionNames());
    expect(names.of('acme', 'conn-1')).toBe('Staging');
    expect(names.of('acme', 'conn-2')).toBe('Production');
  });

  it('is the plugin\'s own: a key that two plugins share names the connection of the one that is asked', () => {
    const { fake } = store([entry('acme', 'main', 'Acme main'), entry('beta', 'main', 'Beta main')]);
    const names = portNamesOf(fake, new ConnectionNames());
    expect(names.of('acme', 'main')).toBe('Acme main');
    expect(names.of('beta', 'main')).toBe('Beta main');
    expect(names.of('gamma', 'main')).toBeUndefined();
  });

  it('is the name a page taught the window, for a connection the window does not list', () => {
    const { fake } = store([]);
    const learned = new ConnectionNames();
    learned.learn('acme', 'conn-1', 'Learned');
    expect(portNamesOf(fake, learned).of('acme', 'conn-1')).toBe('Learned');
  });

  it('prefers the list to what was learned: the list is the host\'s own and current', () => {
    const { fake } = store([entry('acme', 'conn-1', 'Renamed')]);
    const learned = new ConnectionNames();
    learned.learn('acme', 'conn-1', 'Old name');
    expect(portNamesOf(fake, learned).of('acme', 'conn-1')).toBe('Renamed');
  });

  it('is nothing for a connection that neither knows, and never the id', () => {
    const { fake } = store([entry('acme', 'conn-1', 'Staging')]);
    expect(portNamesOf(fake, new ConnectionNames()).of('acme', 'conn-9')).toBeUndefined();
  });

  it('reads the list as it is now, not as it was when the names were made', () => {
    const rig = store([]);
    const names = portNamesOf(rig.fake, new ConnectionNames());
    expect(names.of('acme', 'conn-1')).toBeUndefined();
    rig.set([entry('acme', 'conn-1', 'Staging')]);
    expect(names.of('acme', 'conn-1')).toBe('Staging');
  });

  it('is what the learned names say, alone, in a window with no connection list', () => {
    const learned = new ConnectionNames();
    learned.learn('acme', 'conn-1', 'Learned');
    const names = portNamesOf(undefined, learned);
    expect(names.of('acme', 'conn-1')).toBe('Learned');
    expect(names.of('acme', 'conn-2')).toBeUndefined();
  });
});

describe('hearing that a name changed', () => {
  it('is hearing the list: a listener is told when the connections change, and stops when it is taken off', () => {
    const rig = store([]);
    const names = portNamesOf(rig.fake, new ConnectionNames());
    const listener = vi.fn();
    const stop = names.subscribe(listener);
    expect(rig.listeners()).toBe(1);
    rig.set([entry('acme', 'conn-1', 'Staging')]);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    expect(rig.listeners()).toBe(0);
    rig.set([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('has the learned names alone to hear in a window with no connection list, and there is nothing of the list to take off', () => {
    const names = portNamesOf(undefined, new ConnectionNames());
    const stop = names.subscribe(vi.fn());
    expect(() => {
      stop();
    }).not.toThrow();
  });
});

describe('hearing that a learned name changed', () => {
  it('is hearing the learned names too: a listener is told when a page teaches the window a name, as it is when the list changes, and neither after it is taken off', () => {
    const rig = store([]);
    const learned = new ConnectionNames();
    const names = portNamesOf(rig.fake, learned);
    const listener = vi.fn();
    const stop = names.subscribe(listener);
    learned.learn('acme', 'conn-1', 'Staging');
    expect(listener).toHaveBeenCalledTimes(1);
    rig.set([entry('acme', 'conn-2', 'Other')]);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    learned.learn('acme', 'conn-1', 'Renamed');
    rig.set([]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(rig.listeners()).toBe(0);
  });

  it('is told of the learned name alone in a window with no connection list, and the name is there to be read when it is told', () => {
    const learned = new ConnectionNames();
    const names = portNamesOf(undefined, learned);
    let heard: string | undefined;
    const stop = names.subscribe(() => {
      heard = names.of('acme', 'conn-1');
    });
    learned.learn('acme', 'conn-1', 'Staging');
    expect(heard).toBe('Staging');
    stop();
    learned.learn('acme', 'conn-1', 'Renamed');
    expect(heard).toBe('Staging');
  });
});
