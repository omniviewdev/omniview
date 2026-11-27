import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_HOST, type TerminalsOptions } from '../../shell';
import { fakeEngineLoader, fakeTerminalFeed, type FakeTerminalFeed } from '../../shell/panel/terminal/testing';
import { acme } from '../testing';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// THE FINISHED-COMMAND NOTICE THROUGH THE REAL WINDOW (issue #694 step 6): a command that ran long in a terminal that is not in front is a toast of the window's own notices, and its Show brings that terminal forward. The emulator
// is a fake and the feeds are fakes; the host, the shell, the panel and the toasts are the real ones.

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};


afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  const loader = fakeEngineLoader();
  const feeds: FakeTerminalFeed[] = [];
  const titles = ['one', 'two'];
  const terminals: TerminalsOptions = {
    load: loader.load,
    target: () => {
      const feed = fakeTerminalFeed();
      feeds.push(feed);
      return { plugin: PANEL_HOST, id: 'fake', title: titles[feeds.length - 1] ?? 'more', open: () => feed };
    },
  };
  render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} terminals={terminals} />);
  return { feeds, user: userEvent.setup() };
}

describe('a long command in a terminal that is not in front', () => {
  it('is a toast of the window\'s notices with a Show, and Show brings that terminal forward', async () => {
    const { feeds, user } = mount();
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    await user.click(screen.getAllByRole('button', { name: 'New terminal' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'New terminal' })[0]);
    expect(feeds).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'two' })).toHaveAttribute('aria-selected', 'true');
    // The terminal in front says a long command finished: the person is looking at it, so there is no notice.
    act(() => {
      feeds[1]?.set({ finished: { id: 'c1', exit: 0, durationMs: 60_000, command: 'make', timeMs: 1 } });
    });
    expect(screen.queryByText('Command finished in two')).toBeNull();
    act(() => {
      feeds[0]?.set({ finished: { id: 'c1', exit: 0, durationMs: 60_000, command: 'make', timeMs: 1 } });
    });
    expect(await screen.findByText('Command finished in one')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('tab', { name: 'one' })).toHaveAttribute('aria-selected', 'true');
  });
});
