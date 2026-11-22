import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../core/fields/testing';
import { fakeHost, fakeWindows, type FakeWindows } from './model/testing';
import type { SettingsRequest } from './model/types';
import SettingsWindow from './window';

// The Settings window's content over the real session, the real form model and the real kit parts, with a host that answers from memory (`model/testing.ts`) and a window service that is only its three calls. What the
// host's requests do to it is read here; what a native window is (its size, its chrome, being one instance) is the host's and cannot be seen in jsdom (docs/ui-next/status/ST1.md, the manual check).

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let round = 0; round < 12; round += 1) {
      await Promise.resolve();
    }
  });
};

async function mountWindow(first?: SettingsRequest): Promise<{ readonly windows: FakeWindows; readonly host: ReturnType<typeof fakeHost> }> {
  const host = fakeHost();
  const windows = fakeWindows(first);
  render(<SettingsWindow client={host.client} windows={windows.client} />);
  await settle();
  return { windows, host };
}

const selectedPage = (): string | null => screen.getByRole('button', { current: 'page' }).textContent;

describe('the window', () => {
  it('draws Settings and no shell: a caption named Settings with Close, the pages and a page, not a dialog', async () => {
    await mountWindow();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Settings pages' })).getAllByRole('button').length).toBeGreaterThan(3);
  });

  it('opens on the page the host\'s request names, and on the first page when the request names none', async () => {
    await mountWindow({ requestId: 1, target: '/settings?category=terminal', visible: true });
    expect(selectedPage()).toBe('Terminal');
    cleanup();
    await mountWindow({ requestId: 1, target: '/settings', visible: true });
    expect(selectedPage()).toBe('Appearance');
  });

  it('goes to the page of a new request, and stays where it is for a show or a hide of the same one', async () => {
    const { windows } = await mountWindow({ requestId: 1, target: '/settings?category=general', visible: true });
    expect(selectedPage()).toBe('General');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Editor' }));
    expect(selectedPage()).toBe('Editor');
    await act(async () => {
      windows.emit({ requestId: 1, target: '/settings?category=general', visible: false });
    });
    await act(async () => {
      windows.emit({ requestId: 1, target: '/settings?category=general', visible: true });
    });
    expect(selectedPage()).toBe('Editor');
    await act(async () => {
      windows.emit({ requestId: 2, target: '/settings?category=developer', visible: true });
    });
    expect(selectedPage()).toBe('Developer Settings');
  });

  it('keeps a request that arrives while the first answer is on its way: the slower, older answer does not overwrite it', async () => {
    const host = fakeHost();
    const windows = fakeWindows();
    const slow = deferred<SettingsRequest>();
    render(<SettingsWindow client={host.client} windows={{ ...windows.client, state: async () => slow.promise }} />);
    await settle();
    await act(async () => {
      windows.emit({ requestId: 2, target: '/settings?category=terminal', visible: true });
    });
    await act(async () => {
      slow.resolve({ requestId: 1, target: '/settings?category=general', visible: true });
    });
    await settle();
    expect(selectedPage()).toBe('Terminal');
  });

  it('asks the host again what it holds when it is shown after being hidden, and not for a hide', async () => {
    const { windows, host } = await mountWindow();
    expect(host.calls.snapshot).toBe(1);
    await act(async () => {
      windows.emit({ requestId: 1, target: '/settings?category=general', visible: false });
    });
    await settle();
    expect(host.calls.snapshot).toBe(1);
    expect(document.querySelector('[data-settings-part="window"]')).toHaveAttribute('data-visible', 'false');
    await act(async () => {
      windows.emit({ requestId: 1, target: '/settings?category=general', visible: true });
    });
    await settle();
    expect(host.calls.snapshot).toBe(2);
    expect(document.querySelector('[data-settings-part="window"]')).toHaveAttribute('data-visible', 'true');
  });

  it('hides the window with Close, Escape and the close chord, and takes a key that something already used from nobody', async () => {
    const { windows } = await mountWindow();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(windows.calls.hide).toBe(1);
    await user.keyboard('{Escape}');
    expect(windows.calls.hide).toBe(2);
    await user.keyboard('{Control>}w{/Control}');
    expect(windows.calls.hide).toBe(3);
    const used = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.addEventListener(
      'keydown',
      (event) => {
        event.preventDefault();
      },
      { once: true, capture: true },
    );
    document.dispatchEvent(used);
    await settle();
    expect(windows.calls.hide).toBe(3);
  });

  it('holds no listener after it goes: the host\'s requests reach nothing', async () => {
    const host = fakeHost();
    const windows = fakeWindows();
    const view = render(<SettingsWindow client={host.client} windows={windows.client} />);
    await settle();
    view.unmount();
    expect(() => {
      windows.emit({ requestId: 9, target: '/settings?category=terminal', visible: true });
    }).not.toThrow();
  });
});
