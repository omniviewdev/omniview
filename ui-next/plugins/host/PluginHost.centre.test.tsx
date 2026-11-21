import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoticesStore, loadNotices, type NoticesStorage } from '../../shell';
import { installPopover, teardown } from '../../shell/notices/testing';
import type { DetailPageV1, DetailView } from '../contract/v1';
import { acme } from '../testing';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import type { HostRoute } from './route';

// The notification centre in the whole window (O1b-2; ch16 S80, S81): the host makes the centre with the store, the bell is in the status bar, the history the window saved comes back before it draws, and what a page
// command's failure leaves in the history is saved. The window is the real one over an invented plugin (Acme); the place the history is kept is a fake with the three calls of the real one (`shell/notices/storage.ts`).
// What the real host's window service does across a reload is the seam check's (ui-next/plugins/e2e/seam.check.mjs).

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// jsdom has no Popover API: the centre is a popover, and `installPopover` is the rule that shows it (the same as the shell's own tests use).
beforeEach(installPopover);
afterEach(teardown);

const envelope = (code: string, type: string, title: string, status: number, detail: string) => ({ type, title, status, detail, code, requestId: '5b8c2f6e-7a43-4e0a-9d1f-0c7a1d2e3f40', recovery: 'none' });
const TIMEOUT = envelope('TIMEOUT', 'omniview:resource/timeout', 'Timed out', 408, 'The cluster did not complete the request in time.');
const FORBIDDEN = envelope('FORBIDDEN', 'omniview:resource/forbidden', 'Access denied', 403, 'The operation is not permitted.');
const UNAUTHORIZED = envelope('UNAUTHORIZED', 'omniview:resource/unauthorized', 'Sign in again', 401, 'The credentials were refused.');
const INTERNAL = envelope('INTERNAL', 'omniview:internal', 'Something went wrong', 500, 'The host failed.');
const wails = (body: Readonly<Record<string, unknown>>): Error => Object.assign(new Error(JSON.stringify(body)), { cause: body });

const scale = vi.fn<() => Promise<void>>();

const view = (): DetailView => ({
  state: { role: 'running', label: 'Running' },
  facts: [{ text: 'Sprocket' }],
  commands: { primary: { id: 'scale', label: 'Scale', onSelect: scale } },
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

/** The place the history is kept: what it holds, and every text written to it. */
function place(saved?: string): NoticesStorage & { readonly writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    read: async () => Promise.resolve(saved),
    write: async (text) => {
      writes.push(text);
      return Promise.resolve();
    },
    keep: async () => Promise.resolve(),
  };
}

/** A history a window saved earlier: a failure with a Retry that is unread, and a read message. */
function savedHistory(): string {
  const earlier = createNoticesStore();
  earlier.notify({ title: 'Snapshot created', severity: 'success', source: 'acme' });
  earlier.readAll();
  earlier.notify({ title: 'Timed out', detail: 'The cluster did not complete the request in time.', severity: 'error', initiator: 'user', source: 'acme', actions: [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: () => undefined }] });
  return JSON.stringify(earlier.serialise());
}

async function mount(storage: NoticesStorage, over: Partial<PluginHostProps> = {}) {
  const savedNotices = await loadNotices(storage, { log: vi.fn() });
  const props: PluginHostProps = { plugins, inventory: 'ready', link, onRetry: vi.fn(), onRetryInventory: vi.fn(), session: undefined, savedNotices, ...over };
  return { ...render(<PluginHost {...props} />), user: userEvent.setup() };
}

const bell = async (): Promise<HTMLElement> => screen.findByRole('button', { name: /^Notifications/ });
const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-notices-part="toast"]')];

describe('the window\'s notification centre', () => {
  it('has the bell in its status bar, last, and opens the centre from it', async () => {
    const { user } = await mount(place());
    const button = await bell();
    expect(within(screen.getByRole('contentinfo', { name: 'Status bar' })).getAllByRole('button').at(-1)).toBe(button);
    await user.click(button);
    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('brings the saved history back before the window draws: the bell counts what was unread, the centre lists both, and no toast is drawn for any of it', async () => {
    const { user } = await mount(place(savedHistory()));
    const button = await bell();
    expect(button).toHaveAccessibleName('Notifications, 1 unread, 1 error');
    expect(toasts()).toHaveLength(0);
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' });
    const rows = [...dialog.querySelectorAll<HTMLElement>('[data-notices-part="row"]')];
    expect(rows.map((row) => row.querySelector('[data-notices-part="rowTitle"]')?.textContent)).toEqual(['Error: Timed out', 'Success: Snapshot created']);
    expect(rows[0]?.hasAttribute('data-unread')).toBe(true);
    expect(rows[1]?.hasAttribute('data-unread')).toBe(false);
  });

  it('does not offer the Retry of a restored failure, which was code in the window that is gone, and says why under its text', async () => {
    const { user } = await mount(place(savedHistory()));
    await user.click(await bell());
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' });
    const row = dialog.querySelector<HTMLElement>('[data-notices-part="row"]')!;
    await user.click(within(row).getByRole('button', { expanded: false }));
    expect(within(row).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(row.textContent).toContain('Retry is unavailable. Not available after restart.');
  });

  it('saves what a failed page command leaves in the history, after the quiet time, and nothing before it', async () => {
    scale.mockRejectedValue(wails(TIMEOUT));
    const storage = place();
    const { user } = await mount(storage);
    await user.click(await screen.findByRole('button', { name: 'Scale' }));
    await screen.findByRole('alert', { name: 'Error: Timed out' });
    expect(storage.writes).toEqual([]);
    await vi.waitFor(
      () => {
        expect(storage.writes.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
    const text = storage.writes.at(-1) ?? '';
    expect(text).toContain('"title":"Timed out"');
    expect(text).toContain('"version":1');
  });

  it('opens from the summary toast\'s Show when more toasts are due than the stack draws: the same centre as the bell\'s, with the stack waiting and every record listed', async () => {
    const { user } = await mount(place());
    const bodies = [TIMEOUT, FORBIDDEN, UNAUTHORIZED, INTERNAL];
    for (const [index, body] of bodies.entries()) {
      scale.mockRejectedValueOnce(wails(body));
      await user.click(await screen.findByRole('button', { name: 'Scale' }));
      await screen.findByRole('button', { name: new RegExp(`^Notifications, ${index + 1} unread`) });
    }

    await user.click(await screen.findByRole('button', { name: 'Show' }));
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(dialog.querySelectorAll('[data-notices-part="row"]')).toHaveLength(bodies.length);
    // The model tells the view at most once a frame, so the stack is gone a frame after the centre opens.
    await vi.waitFor(() => {
      expect(toasts()).toHaveLength(0);
    });
  });

  it('puts a failure that arrives while the centre is open in its list and raises no toast for it, now or when the centre closes: one presenter', async () => {
    // A press outside closes the centre, so the command is started first, and fails while the centre is open.
    const later = Promise.withResolvers<void>();
    scale.mockReturnValue(later.promise);
    const { user } = await mount(place());
    await user.click(await screen.findByRole('button', { name: 'Scale' }));
    await user.click(await bell());
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(dialog.querySelectorAll('[data-notices-part="row"]')).toHaveLength(0);
    later.reject(wails(TIMEOUT));
    await vi.waitFor(() => {
      expect(dialog.querySelectorAll('[data-notices-part="row"]')).toHaveLength(1);
    });
    expect(toasts()).toHaveLength(0);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    // Several frames of the model: a toast that was raised while the centre was open would be drawn by now.
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(toasts()).toHaveLength(0);
    expect(await bell()).toHaveAccessibleName('Notifications, 1 unread, 1 error');
  });
});
