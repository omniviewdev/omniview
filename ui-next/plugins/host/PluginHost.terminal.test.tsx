import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_HOST, type TerminalsOptions } from '../../shell';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader } from '../../shell/panel/terminal/testing';
import { openSession, SESSION_VERSION, type LoadedSession } from '../../shell/session';
import { acme } from '../testing';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// The Terminal's screen reader mode through the real window (docs/ui-next/status/T1.md, section 16): the palette lists the command, running it changes the one choice every terminal follows, the result is said once
// through the window's own polite live region, and the choice is saved with the session and comes back. The emulator is a fake (what the real one does with the option is the probe's, in a real engine); the host, the shell, the
// palette and the live region are the real ones.

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

// jsdom has no modal dialog: a stand-in that opens the element, as the attribute does (what a modal does in a real engine is the probe's).
const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// The terminal reads its settings through `shell/settings/runtime`, a lazy chunk: on a cold transform cache its first import outlasts what a test waits for. Load it before the tests, under the hook's own timeout.
beforeAll(async () => {
  await import('../../shell/settings/runtime');
}, 60_000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A saved window, as a previous run left it: the first release's document has no screen reader choice, the current one has it. */
function savedWindow(extra: Record<string, unknown> = {}): { readonly session: LoadedSession; readonly written: string[] } {
  const text = JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: null, tabs: [] }, rail: null, panel: { version: 1 }, ...extra });
  const written: string[] = [];
  const session = openSession(
    {
      read: async () => text,
      write: async (next) => {
        written.push(next);
      },
      keep: async () => undefined,
    },
    text,
  );
  return { session, written };
}

function mount(session?: LoadedSession) {
  const loader: FakeEngineLoader = fakeEngineLoader();
  const terminals: TerminalsOptions = { load: loader.load, target: () => ({ plugin: PANEL_HOST, id: 'fake', title: 'Terminal', open: () => fakeTerminalFeed() }) };
  const view = render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} session={session} terminals={terminals} />);
  return { ...view, loader, user: userEvent.setup() };
}

/** Opens the panel, which shows the Terminal tool, and starts a terminal from the button of its empty state. */
async function openTerminal(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Panel' }));
  await user.click(screen.getAllByRole('button', { name: 'New terminal' })[0]);
}

/** The palette, opened with its Search control, asked for the switch and run with Enter. */
async function runSwitch(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^Search/ }));
  await user.keyboard('screen reader');
  await screen.findByRole('option', { name: /^Command: Terminal: Toggle Screen Reader Mode/ });
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

/** What the window's polite live region was told, in order: the text of each announcement that arrived (the node is replaced for each, so a sentence told twice is two). */
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

describe('the Terminal\'s screen reader switch through the window', () => {
  it('is in the palette, and running it turns the mode on in the terminal that is open and says so once through the window\'s polite live region; running it again turns it off and says that', async () => {
    const { user, loader } = mount();
    await openTerminal(user);
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    expect(loader.engines[0]?.options.screenReaderMode).toBe(false);
    const heard = told();

    await runSwitch(user);
    await waitFor(() => {
      expect(heard.said).toEqual(['Terminal screen reader mode on.']);
    });
    expect(loader.engines[0]?.screenReaderModes).toEqual([true]);
    // Once: nothing else arrives afterwards.
    const quiet = Promise.withResolvers<void>();
    setTimeout(quiet.resolve, 50);
    await act(async () => quiet.promise);
    expect(heard.said).toEqual(['Terminal screen reader mode on.']);

    await runSwitch(user);
    await waitFor(() => {
      expect(heard.said).toEqual(['Terminal screen reader mode on.', 'Terminal screen reader mode off.']);
    });
    expect(loader.engines[0]?.screenReaderModes).toEqual([true, false]);
    heard.stop();
  });

  it('is the window\'s one choice: a terminal started after it was turned on is made in the mode, and its description says so', async () => {
    const { user, loader } = mount();
    await openTerminal(user);
    await runSwitch(user);
    await waitFor(() => {
      expect(loader.engines[0]?.screenReaderModes).toEqual([true]);
    });

    await user.click(screen.getAllByRole('button', { name: 'New terminal' })[0]);
    await waitFor(() => {
      expect(loader.engines).toHaveLength(2);
    });
    expect(loader.engines[1]?.options.screenReaderMode).toBe(true);
    const [, hintId] = loader.engines[1]?.labels[0] ?? ['', ''];
    expect(document.getElementById(hintId)?.textContent).toContain('Screen reader mode is on');
  });

  it('says nothing and changes nothing until the person runs it: a window that never chose has the mode off and its live region empty', async () => {
    const { user, loader } = mount();
    await openTerminal(user);
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    expect(loader.engines[0]?.options.screenReaderMode).toBe(false);
    expect(loader.engines[0]?.screenReaderModes).toEqual([]);
    expect(document.querySelector('[data-notices-part="live"]')?.textContent).toBe('');
  });
});

describe('the choice and the session', () => {
  it('comes back as the person left it: a window saved with the mode on makes its terminals in it', async () => {
    const { session } = savedWindow({ terminalScreenReader: true });
    const { user, loader } = mount(session);
    await openTerminal(user);
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    expect(loader.engines[0]?.options.screenReaderMode).toBe(true);
    expect(loader.engines[0]?.screenReaderModes).toEqual([]);
  });

  it('is off for a window saved by the first release, which had no such choice: it is not louder than it was', async () => {
    const text = JSON.stringify({ version: 1, tabs: { version: 1, active: null, tabs: [] }, rail: null, panel: { version: 1 } });
    const session = openSession({ read: async () => text, write: async () => undefined, keep: async () => undefined }, text);
    const { user, loader } = mount(session);
    await openTerminal(user);
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    expect(loader.engines[0]?.options.screenReaderMode).toBe(false);
  });

  it('is saved with the window\'s session once it changes, and is in what is written when the window goes', async () => {
    const { session, written } = savedWindow();
    const { user, loader, unmount } = mount(session);
    await openTerminal(user);
    await runSwitch(user);
    await waitFor(() => {
      expect(loader.engines[0]?.screenReaderModes).toEqual([true]);
    });
    unmount();
    // What the window leaves is the last thing written: an earlier write (the panel's opening) may land first, so the first one written is not the one to read.
    await waitFor(() => {
      expect(JSON.parse(written.at(-1) ?? 'null')).toMatchObject({ version: SESSION_VERSION, terminalScreenReader: true });
    });
  });
});
