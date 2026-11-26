import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, PANEL_HOST, type TerminalsOptions } from '../../shell';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader } from '../../shell/panel/terminal/testing';
import { acme } from '../testing';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';
import type { WindowService } from './windows';

// The native menu (`backend/menus`) reaches the window as the app event `menu/command`, to every window, with the id of a host command: the one that has the focus runs it as the palette runs a chosen row, with the palette
// closed, and says why when it cannot; the others ignore it. A browser tab has no window service, so it listens to nothing.

const EVENT = 'menu/command';
const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

// jsdom has no modal dialog: a stand-in that opens the element, as the attribute does (what a modal does in a real engine is the shell's probes').
const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

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
    emit: (data: unknown) => {
      act(() => {
        for (const listener of listeners.get(EVENT) ?? []) {
          listener(data);
        }
      });
    },
  };
}

function mount(windows?: WindowService) {
  const loader: FakeEngineLoader = fakeEngineLoader();
  const terminals: TerminalsOptions = { load: loader.load, target: () => ({ plugin: PANEL_HOST, id: 'fake', title: 'Terminal', open: () => fakeTerminalFeed() }) };
  const panel = createPanelStore();
  const view = render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} panel={panel} terminals={terminals} windows={windows} />);
  return { ...view, loader, panel };
}

/** What the window's polite live region was told, in order. */
function told(): { readonly said: string[]; readonly stop: () => void } {
  const region = document.querySelector('[data-notices-part="live"]');
  if (region === null) {
    throw new Error('the window has no polite live region');
  }

  const said: string[] = [];
  const observer = new MutationObserver(() => {
    const text = region.textContent ?? '';
    if (text !== '' && said.at(-1) !== text) {
      said.push(text);
    }
  });
  observer.observe(region, { subtree: true, childList: true, characterData: true });
  return { said, stop: () => {
    observer.disconnect();
  } };
}

describe('the menu\'s commands in a native window', () => {
  it('runs the host command the id names when the window has the focus: host.terminal.new opens the panel on the Terminal with a session, and each one adds another', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const world = service();
    const { loader } = mount(world.windows);
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull();

    world.emit('host.terminal.new');
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    expect(screen.getAllByRole('tab', { name: /Terminal/ }).length).toBeGreaterThan(0);

    world.emit('host.terminal.new');
    await waitFor(() => {
      expect(loader.engines).toHaveLength(2);
    });
  });

  it('runs any other command of the host the same way: host.panel.toggle toggles the panel, host.search opens the palette', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const world = service();
    const { panel } = mount(world.windows);

    world.emit('host.panel.toggle');
    expect(panel.getSnapshot().open).toBe(true);

    world.emit('host.search');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('is ignored by a window that does not have the focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const world = service();
    const { panel } = mount(world.windows);

    world.emit('host.panel.toggle');
    world.emit('host.search');

    expect(panel.getSnapshot().open).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is ignored while the palette is open: nothing runs behind a modal', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const user = userEvent.setup();
    const world = service();
    const { panel } = mount(world.windows);
    await user.click(screen.getByRole('button', { name: /^Search/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();

    world.emit('host.panel.toggle');

    expect(panel.getSnapshot().open).toBe(false);
  });

  it('is ignored while the question of closing a running terminal is open: nothing runs behind that modal either', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const world = service();
    const { loader, panel } = mount(world.windows);
    world.emit('host.terminal.new');
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    fireEvent.keyDown(document.querySelector('[data-shell-part="sessionTab"] [role="tab"]') ?? document.body, { key: 'Delete' });
    expect(await screen.findByRole('alertdialog')).toBeTruthy();

    world.emit('host.panel.toggle');

    expect(panel.getSnapshot().open).toBe(true);
  });

  it('says why a command cannot run, through the polite live region, and says nothing for a payload that is no id', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const world = service();
    mount(world.windows);
    const heard = told();

    world.emit('host.tab.reopen');
    await waitFor(() => {
      expect(heard.said).toEqual(['There are no recently closed tabs']);
    });

    world.emit('host.nope');
    await waitFor(() => {
      expect(heard.said).toEqual(['There are no recently closed tabs', 'This command is not available.']);
    });

    world.emit(undefined);
    world.emit(42);
    await act(async () => {
      await Promise.resolve();
    });
    expect(heard.said).toHaveLength(2);
    heard.stop();
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
