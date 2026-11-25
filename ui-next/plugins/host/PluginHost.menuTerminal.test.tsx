import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_HOST, type TerminalsOptions } from '../../shell';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader } from '../../shell/panel/terminal/testing';
import { acme } from '../testing';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';
import type { WindowService } from './windows';

// View > New Terminal Session of the native menu (`backend/menus`) reaches the window as the app event `menu/view/terminal/create`, to every window: the one that has the focus starts what the Terminal's `+` starts, in the panel,
// and the others ignore it. A browser tab has no window service, so it listens to nothing.

const EVENT = 'menu/view/terminal/create';
const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The host's window service as far as the tree reads it: it keeps the listeners by event name, and tells the test which are listening. */
function service() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const on = vi.fn<WindowService['on']>((event, listener) => {
    const set = listeners.get(event) ?? new Set();
    set.add(listener);
    listeners.set(event, set);
    return () => {
      set.delete(listener);
    };
  });
  const windows = { name: async () => 'main', viewport: async () => undefined, list: async () => [], on } as unknown as WindowService;
  return {
    windows,
    on,
    listening: () => listeners.get(EVENT)?.size ?? 0,
    emit: () => {
      for (const listener of listeners.get(EVENT) ?? []) {
        listener(undefined);
      }
    },
  };
}

function mount(windows?: WindowService) {
  const loader: FakeEngineLoader = fakeEngineLoader();
  const terminals: TerminalsOptions = { load: loader.load, target: () => ({ plugin: PANEL_HOST, id: 'fake', title: 'Terminal', open: () => fakeTerminalFeed() }) };
  const view = render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} terminals={terminals} windows={windows} />);
  return { ...view, loader };
}

describe('the menu\'s New Terminal Session in a native window', () => {
  it('opens the panel on the Terminal with one new session when the window has the focus', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const world = service();
    const { loader } = mount(world.windows);
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull();

    act(() => {
      world.emit();
    });

    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    expect(screen.getAllByRole('tab', { name: /Terminal/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'New terminal' }).length).toBeGreaterThan(0);
  });

  it('starts the same session as the button of the strip: a second one adds a second', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const world = service();
    const { loader } = mount(world.windows);
    const user = userEvent.setup();
    act(() => {
      world.emit();
    });
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });

    await user.click(screen.getAllByRole('button', { name: 'New terminal' })[0]);
    await waitFor(() => {
      expect(loader.engines).toHaveLength(2);
    });
  });

  it('is ignored by a window that does not have the focus', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const world = service();
    const { loader } = mount(world.windows);

    act(() => {
      world.emit();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader.engines).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull();
  });

  it('stops listening when the window goes', () => {
    const world = service();
    const { unmount } = mount(world.windows);
    expect(world.listening()).toBe(1);

    unmount();

    expect(world.listening()).toBe(0);
  });

  it('registers nothing in a browser tab, which has no window service', () => {
    const world = service();
    mount(undefined);

    expect(world.on).not.toHaveBeenCalled();
    expect(world.listening()).toBe(0);
  });
});
