import type { IconName } from '@omniviewdev/kit';
import { vi, type Mock } from 'vitest';
import type { ShellAccent } from '../../shell';
import { createRecents, type ActionResult, type ConnectionActions, type ConnectionsApi, type ConnectionState, type ConnectionsState, type ConnectionsStore, type HostConnection, type HostConnections, type RecentsStore } from './connections';
import type { PluginSource } from './contributions';
import type { PluginEntry } from './pluginStore';

// Test support only: nothing in the host imports this file. The window's stores as the tests of Home (`homePage.test.tsx`, `NoTabs.test.tsx`) need them: the plugins and the connections it reads, and the actions it calls, with no runtime and no host.

/** A plugin that is ready: what the rail lists it by, and the colour and glyph its tile wears on Home. */
export function readyEntry(id: string, name: string, over: { readonly order?: number; readonly icon?: IconName; readonly accent?: ShellAccent } = {}): PluginEntry {
  return {
    id,
    name,
    phase: 'ready',
    contribution: {
      plugin: { name, accent: over.accent },
      rail: { icon: over.icon ?? 'layers', order: over.order },
      sidebar: { label: name, title: name, nodes: [] },
      pages: {},
      home: 'items',
    },
  };
}

export type FakePlugins = PluginSource & { readonly set: (next: readonly PluginEntry[]) => void };

/** A plugin store that says so when its list is replaced. */
export function pluginSource(initial: readonly PluginEntry[]): FakePlugins {
  let entries = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => entries,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      entries = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

/** One connection as the host's store lists it. */
export const connection = (plugin: string, key: string, name: string, state: ConnectionState = 'connected', over: Partial<Pick<HostConnection, 'detail' | 'reason' | 'labels' | 'busy'>> = {}): HostConnection => ({ plugin, key, name, state, reason: undefined, ...over });

export type FakeStore = ConnectionsStore & {
  /** The state is replaced: a list is read, a read failed. */
  readonly set: (next: Partial<ConnectionsState>) => void;
  readonly refresh: Mock<ConnectionsStore['refresh']>;
};

/** A connection store that has read the given connections; `loaded: false` for one that has not read yet. */
export function connectionStore(connections: readonly HostConnection[], over: Partial<Pick<ConnectionsState, 'loaded' | 'failed'>> = {}): FakeStore {
  let state: ConnectionsState = { loaded: true, failed: false, connections, ...over };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      state = { ...state, ...next };
      for (const listener of [...listeners]) {
        listener();
      }
    },
    refresh: vi.fn<ConnectionsStore['refresh']>(async () => Promise.resolve()),
    connect: vi.fn(async () => Promise.resolve({ status: 'connected' as const })),
    hold: vi.fn<ConnectionsStore['hold']>(() => ({ ok: false, reason: 'This test does not hold connections.' })),
    reload: vi.fn<ConnectionsStore['reload']>(async () => Promise.resolve()),
    attach: vi.fn(() => () => undefined),
  };
}

export type FakeHost = HostConnections & {
  readonly store: FakeStore;
  readonly recents: RecentsStore;
  readonly go: Mock<ConnectionActions['go']>;
};

/** What a window that knows these connections hands Home: the store, the recents (the real ones, empty) and actions that record what they were asked and say they worked. */
export function hostConnections(store: FakeStore): FakeHost {
  const worked = async (): Promise<ActionResult> => Promise.resolve({ ok: true });
  const go = vi.fn<ConnectionActions['go']>(worked);
  return {
    store,
    recents: createRecents(),
    actions: { switchTab: vi.fn<ConnectionActions['switchTab']>(worked), go, goOrSwitch: vi.fn<ConnectionActions['goOrSwitch']>(worked) },
    go,
  };
}

/** The calls of the host's connection API that a verb makes, for a test of another part that gives the window an API and never calls them: each one says so if it is. */
export const unusedVerbs: Pick<ConnectionsApi, 'check' | 'stop' | 'remove' | 'load'> = {
  check: async () => Promise.reject(new Error('this test does not check a connection')),
  stop: async () => Promise.reject(new Error('this test does not stop a connection')),
  remove: async () => Promise.reject(new Error('this test does not remove a connection')),
  load: async () => Promise.reject(new Error('this test does not load connections')),
};
