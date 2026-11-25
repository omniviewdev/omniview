import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../shell';
import { acme } from '../testing';
import type { ConnectionsApi, StateRecord } from './connections/api';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE, type HostRoute } from './route';

// A plugin is never opened on a connection nobody chose (HM2, rule R4; CodeRabbit on #676): a link that names no connection, and a press on a plugin in the empty window, wait for the window to know the plugin's connections,
// and what they come to is what the rule says (the only connection, the one last used, else Home). A first read that failed leaves the window as it is, and a read that works later completes the link. The host is the real
// window over an invented plugin (Acme); the host's connection API is a table of promises the test settles, so the order in which the host answers is the test's.

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

afterEach(cleanup);

type Answer = Readonly<Record<string, readonly StateRecord[]>>;

const running: PluginEntry = { id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() };
const entries: readonly PluginEntry[] = [running];
const link = (plugin: string, page?: string, connection?: string): HostRoute => ({ plugin, page, connection, params: {} });
const connected = (id: string): StateRecord => ({ connection: { id, name: id }, readiness: 'CONNECTED' });

/** The host's connection API: every read of the list is a promise the test settles; `say` is the host telling the window that a connection changed. */
function fakeHost() {
  const reads: Array<PromiseWithResolvers<Answer>> = [];
  const heard = new Set<() => void>();
  const api: ConnectionsApi = {
    states: async () => {
      const read = Promise.withResolvers<Answer>();
      reads.push(read);
      return read.promise;
    },
    start: async () => Promise.resolve({ status: 'CONNECTED' }),
    onStatus: (listener) => {
      heard.add(listener);
      return () => {
        heard.delete(listener);
      };
    },
    onSync: () => () => undefined,
  };
  return {
    api,
    reads,
    say: () => {
      for (const listener of [...heard]) {
        listener();
      }
    },
  };
}

async function mount(api: ConnectionsApi, at: HostRoute) {
  const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };
  render(<PluginHost plugins={plugins} inventory="ready" link={at} onRetry={() => undefined} onRetryInventory={() => undefined} panel={createPanelStore()} connections={api} />);
  await act(async () => Promise.resolve());
}

const tabNames = (): string[] => screen.queryAllByRole('tab').map((tab) => tab.getAttribute('aria-label') ?? tab.textContent ?? '');

describe('a link that names no connection', () => {
  it('waits for the list, and then opens the plugin where there is nothing to choose between: its only connection', async () => {
    const host = fakeHost();
    await mount(host.api, link('acme', 'widgets'));

    expect(host.reads).toHaveLength(1);
    expect(tabNames()).toEqual([]);

    await act(async () => {
      host.reads[0]?.resolve({ acme: [connected('north')] });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(tabNames()).toHaveLength(1);
    });
    expect(tabNames()[0]).toContain('Widgets');
  });

  it('opens Home, not the plugin, when the plugin has two connections and none was used: the plugin would take its first', async () => {
    const host = fakeHost();
    await mount(host.api, link('acme', 'widgets'));

    await act(async () => {
      host.reads[0]?.resolve({ acme: [connected('north'), connected('south')] });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(tabNames()).toHaveLength(1);
    });
    expect(tabNames()[0]).toContain('Home');
    expect(tabNames()[0]).not.toContain('Widgets');
  });

  it('opens at the connection it names, without waiting for the list', async () => {
    const host = fakeHost();
    await mount(host.api, link('acme', 'widgets', 'south'));

    await vi.waitFor(() => {
      expect(tabNames()).toHaveLength(1);
    });
    expect(tabNames()[0]).toContain('Widgets');
    expect(host.reads[0]).toBeDefined();
  });

  it('opens nothing while the first read has failed, and completes when a read that works says which connection it is read in', async () => {
    const host = fakeHost();
    await mount(host.api, link('acme', 'widgets'));

    await act(async () => {
      host.reads[0]?.reject(new Error('the host did not answer'));
      await Promise.resolve();
    });
    expect(tabNames()).toEqual([]);

    // The host says a connection changed: the window reads again, and this read works.
    act(() => {
      host.say();
    });
    await vi.waitFor(() => {
      expect(host.reads).toHaveLength(2);
    });
    await act(async () => {
      host.reads[1]?.resolve({ acme: [connected('north')] });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(tabNames()).toHaveLength(1);
    });
    expect(tabNames()[0]).toContain('Widgets');
  });
});

describe('a press on a plugin in the empty window', () => {
  it('is answered when the list is known, not before: the plugin opens in its only connection', async () => {
    const host = fakeHost();
    await mount(host.api, NO_ROUTE);

    await userEvent.setup().click(within(screen.getByRole('region', { name: 'Plugins you can open' })).getByRole('button', { name: /^Acme/ }));
    expect(tabNames()).toEqual([]);

    await act(async () => {
      host.reads[0]?.resolve({ acme: [connected('north')] });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(tabNames()).toHaveLength(1);
    });
    expect(tabNames()[0]).toContain('Widgets');
  });
});
