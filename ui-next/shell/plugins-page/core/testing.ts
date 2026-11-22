import { vi, type Mock } from 'vitest';
import type { PluginEntry } from '../../../plugins/host/pluginStore';
import type { PluginSource } from '../../../plugins/host/contributions';
import { fakeEvents, type FakeEvents } from '../../../plugins/testing';
import type { ActionFailure, PluginActions, PluginsModelDeps } from './model';
import type { InventoryEntry } from './types';

// Test support for the page's model: an invented inventory, the window's plugin store as a table a test sets, and the host's actions as spies. Nothing but tests imports this.

/** An inventory entry of an invented plugin, as the host sends it. */
export function inventoryEntry(id: string, patch: Partial<Omit<InventoryEntry, 'metadata'>> & { readonly metadata?: Partial<InventoryEntry['metadata']> } = {}): InventoryEntry {
  const { metadata, ...rest } = patch;
  return {
    id,
    origin: 'external',
    enabled: true,
    phase: 'Running',
    devMode: false,
    releaseChannel: '',
    metadata: {
      name: id.charAt(0).toUpperCase() + id.slice(1),
      version: '1.0.0',
      description: `The ${id} plugin.`,
      category: 'Fixture',
      license: 'Apache-2.0',
      author: { name: 'Fixture Labs' },
      repository: '',
      website: '',
      tags: [],
      dependencies: [],
      capabilities: ['resource'],
      ...metadata,
    },
    ...rest,
  };
}

export type FakeEntries = PluginSource & { readonly set: (entries: readonly PluginEntry[]) => void; readonly listeners: () => number };

/** The window's plugin store as a table: the entries it holds now, and the listeners on it. */
export function fakeEntries(initial: readonly PluginEntry[] = []): FakeEntries {
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
    listeners: () => listeners.size,
  };
}

export type Harness = {
  readonly deps: PluginsModelDeps;
  readonly events: FakeEvents;
  readonly entries: FakeEntries;
  readonly actions: { readonly [K in keyof PluginActions]: Mock<PluginActions[K]> };
  readonly read: Mock<() => Promise<readonly InventoryEntry[]>>;
  readonly retry: Mock<(id: string) => void>;
  readonly fail: Mock<(failure: ActionFailure) => void>;
  /** What the host would list now: the next read answers it. */
  readonly list: { current: readonly InventoryEntry[] };
};

/** A model's dependencies over invented plugins: the list the next read answers, spies for every call the model makes, and the events as a table. */
export function harness(plugins: readonly InventoryEntry[], overrides: Partial<PluginsModelDeps> = {}): Harness {
  const events = fakeEvents();
  const entries = fakeEntries();
  const list = { current: plugins };
  const read = vi.fn<() => Promise<readonly InventoryEntry[]>>(async () => list.current);
  const retry = vi.fn<(id: string) => void>();
  const fail = vi.fn<(failure: ActionFailure) => void>();
  const actions = {
    reload: vi.fn<PluginActions['reload']>(async () => undefined),
    setEnabled: vi.fn<PluginActions['setEnabled']>(async () => undefined),
    uninstall: vi.fn<PluginActions['uninstall']>(async () => undefined),
  };
  return { deps: { read, entries, events: events.source, actions, retry, fail, ...overrides }, events, entries, actions, read, retry, fail, list };
}

/** Lets what a promise settled run: the model's reads and calls answer on microtasks. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}
