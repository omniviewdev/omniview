import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DetailPageV1, DetailView } from '../contract/v1';
import { acme, answering, startedOn, widgetPage, WIDGETS } from '../testing';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import type { HostRoute } from './route';

// A failed action of a PAGE is the one real source of the toast layer (O1b-1; ch16 S75, S77, S85): the detail page's header commands are the plugin's callbacks, and when one throws or rejects with the host's
// `apperror` (what the runtime's hooks throw: a `RuntimeError` whose message is the envelope's JSON) the person gets a failure toast of that plugin, with the class's title, the plugin's one sentence and a Retry that
// asks the same command again. The window is the real one: the host, the shell, the toast layer and the notices model, over an invented plugin (Acme).

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

afterEach(cleanup);

const TIMEOUT = { type: 'omniview:resource/timeout', title: 'Timed out', status: 408, detail: 'The cluster did not complete the request in time.', code: 'TIMEOUT', requestId: '5b8c2f6e-7a43-4e0a-9d1f-0c7a1d2e3f40', recovery: 'none' };
/** What Wails gives a page: an error whose message is the envelope's JSON and whose cause is the object. */
const wails = (body: Readonly<Record<string, unknown>>): Error => Object.assign(new Error(JSON.stringify(body)), { cause: body });

const scale = vi.fn<() => Promise<void>>();
const sync = vi.fn<() => Promise<void>>();
const restart = vi.fn<() => void>();
const fine = vi.fn<() => void>();

const view = (): DetailView => ({
  state: { role: 'running', label: 'Running' },
  facts: [{ text: 'Sprocket' }],
  commands: {
    primary: { id: 'scale', label: 'Scale', onSelect: scale },
    secondary: [{ id: 'restart', label: 'Restart', onSelect: restart }, { id: 'pause', label: 'Pause', onSelect: fine }],
  },
  tabs: { overview: { kind: 'overview', summary: [{ status: { role: 'running', label: 'Running' } }], sections: [{ id: 'details', kind: 'kv', title: 'Details', rows: [{ label: 'Bay', value: 'east' }] }] } },
});

const sprocket: DetailPageV1 = {
  kind: 'detail',
  definition: { kind: 'Sprocket', tile: { icon: 'box' }, identity: { name: 'name', facets: ['bay'] }, list: { page: 'widgets', label: 'Widgets' }, tabs: [{ id: 'overview', label: 'Overview' }] },
  usePage: () => ({ scope: [{ label: 'Connection', icon: 'server', text: 'north' }], source: { state: { kind: 'ready' }, view: view(), refreshing: false, refresh: async () => undefined } }),
};

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme({ pages: { ...acme().pages, sprocket } }) }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };
const link: HostRoute = { plugin: 'acme', page: 'sprocket', connection: 'north', params: { name: 'orders-api', bay: 'east' } };

function mount(over: Partial<PluginHostProps> = {}) {
  const props: PluginHostProps = { plugins, inventory: 'ready', link, onRetry: vi.fn(), onRetryInventory: vi.fn(), session: undefined, ...over };
  return { ...render(<PluginHost {...props} />), user: userEvent.setup() };
}

const layer = (): HTMLElement => document.querySelector<HTMLElement>('[data-notices-part="layer"]')!;
const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-notices-part="toast"]')];

describe('a command of a page that fails', () => {
  it('is a failure toast of that plugin: the class\'s title and the plugin\'s one sentence, an alert, with a Retry (E0-1)', async () => {
    scale.mockRejectedValue(wails(TIMEOUT));
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Scale' }));
    const toast = await screen.findByRole('alert', { name: 'Error: Timed out' });
    expect(within(toast).getByText('The cluster did not complete the request in time.')).toBeInTheDocument();
    expect(within(toast).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(toast).toHaveAttribute('data-sticky');
    expect(layer().contains(toast)).toBe(true);
  });

  it('is told once more with a count when it fails again: Retry asks the same command, and the one toast says "Timed out 2 times"', async () => {
    scale.mockClear();
    scale.mockRejectedValue(wails(TIMEOUT));
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Scale' }));
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(scale).toHaveBeenCalledTimes(2);
      expect(toasts()).toHaveLength(1);
      expect(toasts()[0]).toHaveAttribute('aria-label', 'Error: Timed out 2 times');
    });
  });

  it('shows none of the text of an error that is not the host\'s envelope: raw text is never chrome', async () => {
    restart.mockImplementation(() => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    });
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Restart' }));
    const toast = await screen.findByRole('alert', { name: 'Error: Operation failed' });
    expect(within(toast).getByText('The operation could not be completed.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('hunter2');
  });

  it('is no toast when the command works, and none when it was a cancellation', async () => {
    scale.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Scale' }));
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 60);
    await act(async () => {
      await settled.promise;
    });
    expect(fine).toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });
});

describe('a command of a list page that fails', () => {
  it('is the same failure toast: the guard is on the header of a list page too, not only a detail page\'s', async () => {
    sync.mockRejectedValue(wails(TIMEOUT));
    const base = widgetPage('Widgets', answering(WIDGETS));
    const widgets = { ...base, definition: { ...base.definition, commands: { primary: { id: 'sync', label: 'Sync', onSelect: sync } } } };
    const listed: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme({ pages: { ...acme().pages, widgets } }) }];
    const { user } = mount({ plugins: { getSnapshot: () => listed, subscribe: () => () => undefined }, link: { plugin: 'acme', page: 'widgets', connection: 'north', params: {} } });
    await user.click(await screen.findByRole('button', { name: 'Sync' }));
    const toast = await screen.findByRole('alert', { name: 'Error: Timed out' });
    expect(within(toast).getByText('The cluster did not complete the request in time.')).toBeInTheDocument();
    expect(within(toast).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
