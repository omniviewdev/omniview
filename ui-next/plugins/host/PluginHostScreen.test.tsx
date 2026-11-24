import { Browser, onEventsReconnect } from '@omniviewdev/runtime/runtime';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalsOptions } from '../../shell';
import { attachLocalTerminal, restoreLocalTerminals } from '../../shell/panel/terminal/localShell';
import { PAGE_KEY_SLOT } from '../../shell/panel/terminal/pageKey';
import { PluginHostScreen } from './PluginHostScreen';

// What the screen of contributed pages gives the Terminal tool for a reload (T2-go): the window's page key, read beside its session and its notifications from the host's window service (a slot of its own), and a way
// to find the terminals the window left under that key. The host is drawn once all three have been read, so that its terminals are made with the key from their first press. Everything outside the screen is what the
// test says: the host's window service is a map of slots, and the host component records the props it was given.

type Inventory = { readonly plugins: readonly unknown[]; readonly state: 'ready' | 'loading' | 'failed'; readonly retry: () => void };

const world = vi.hoisted(() => {
  const inventory: Inventory = { plugins: [], state: 'ready', retry: () => undefined };
  return {
    /** The slots of the window, as the host's window service keeps them. */
    slots: new Map<string, string>(),
    /** While it is set, a write to a slot waits for it. */
    held: undefined as Promise<void> | undefined,
    /** Whether a read of the slots fails. */
    unreadable: false,
    /** The slots that were written, in order. */
    written: [] as string[],
    /** The props the host was given, in order. */
    given: [] as Array<{ readonly terminals?: TerminalsOptions | undefined }>,
    /** What the inventory says; a test changes it to have the screen drawn again. */
    inventory,
  };
});

vi.mock('@omniviewdev/runtime/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WindowClient: {
    GetState: async () => {
      if (world.unreadable) {
        throw new Error('the host did not answer');
      }

      return Promise.resolve(Object.fromEntries(world.slots));
    },
    SaveState: async (_name: string, slot: string, json: string) => {
      await world.held;
      world.slots.set(slot, json);
      world.written.push(slot);
    },
    List: async () => Promise.resolve([{ name: 'main' }]),
    OpenSettings: async () => Promise.resolve(),
  },
}));

vi.mock('@omniviewdev/runtime/runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Window: { Name: async () => Promise.resolve('main'), Close: async () => Promise.resolve() },
  Events: { On: () => () => undefined },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the runtime names its browser call `OpenURL`
  Browser: { OpenURL: vi.fn() },
  onEventsReconnect: vi.fn(),
}));

vi.mock('../../shell/panel/terminal/localShell', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), restoreLocalTerminals: vi.fn(), attachLocalTerminal: vi.fn() }));

vi.mock('./useInstalledPlugins', () => ({ useInstalledPlugins: () => world.inventory }));

vi.mock('./PluginHost', () => ({
  PluginHost: (props: { readonly terminals?: TerminalsOptions | undefined }) => {
    world.given.push(props);
    return null;
  },
}));

const SAVED_KEY = 'a-key-saved-by-an-earlier-page';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(restoreLocalTerminals).mockReset();
  vi.mocked(attachLocalTerminal).mockReset();
  vi.mocked(onEventsReconnect).mockReset();
  vi.mocked(Browser.OpenURL).mockReset();
  vi.mocked(Browser.OpenURL).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  world.slots.clear();
  world.held = undefined;
  world.unreadable = false;
  world.written.length = 0;
  world.given.length = 0;
  world.inventory = { plugins: [], state: 'ready', retry: () => undefined };
});

/** What the host was given when it was drawn last. */
const drawn = (): { readonly terminals?: TerminalsOptions | undefined } | undefined => world.given.at(-1);

/** Lets the reads and writes that are ready run. */
async function turns(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) {
    await Promise.resolve();
  }
}

describe('the page key the screen gives the Terminal tool', () => {
  it('is read before the host is drawn, with the session and the notifications: the host waits for a key that has to be saved first, and is drawn with it once it is', async () => {
    const gate = Promise.withResolvers<void>();
    world.held = gate.promise;
    render(<PluginHostScreen />);
    await turns();
    expect(world.given).toHaveLength(0);
    gate.resolve();
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    const saved: unknown = JSON.parse(world.slots.get(PAGE_KEY_SLOT) ?? 'null');
    expect(typeof saved).toBe('string');
    expect(drawn()?.terminals?.pageKey).toBe(saved);
  });

  it('is the one this window saved before, when it saved one, and nothing is written: a reload finds its terminals under the key they were started with', async () => {
    world.slots.set(PAGE_KEY_SLOT, JSON.stringify(SAVED_KEY));
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(drawn()?.terminals?.pageKey).toBe(SAVED_KEY);
    expect(world.written).not.toContain(PAGE_KEY_SLOT);
  });

  it('is a key of its own for a window whose slots cannot be read, and the window is drawn all the same: a key that lives as long as the page, and a note on the console', async () => {
    world.unreadable = true;
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(drawn()?.terminals?.pageKey).toMatch(/^[\x21-\x7e]{16,128}$/);
    expect(console.warn).toHaveBeenCalled();
  });

  it('comes with a way to find the terminals the window left, which asks the host under that key, when it is asked and not before', async () => {
    world.slots.set(PAGE_KEY_SLOT, JSON.stringify(SAVED_KEY));
    const found = [{ plugin: 'host', id: 'local', title: 'zsh', sessionId: 'term-1', open: vi.fn() }];
    vi.mocked(restoreLocalTerminals).mockResolvedValue(found);
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(restoreLocalTerminals).not.toHaveBeenCalled();
    await expect(drawn()?.terminals?.restore?.()).resolves.toBe(found);
    expect(restoreLocalTerminals).toHaveBeenCalledTimes(1);
    expect(restoreLocalTerminals).toHaveBeenCalledWith(SAVED_KEY);
  });

  it('comes with a way to attach a terminal again that this window lost to another tab, which attaches it under the window\'s key, when it is asked and not before', async () => {
    world.slots.set(PAGE_KEY_SLOT, JSON.stringify(SAVED_KEY));
    const target = { plugin: 'host', id: 'local', title: 'zsh', sessionId: 'term-7', open: vi.fn() };
    vi.mocked(attachLocalTerminal).mockReturnValue(target);
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(attachLocalTerminal).not.toHaveBeenCalled();
    expect(drawn()?.terminals?.reattach?.('term-7')).toBe(target);
    expect(attachLocalTerminal).toHaveBeenCalledTimes(1);
    expect(attachLocalTerminal).toHaveBeenCalledWith(SAVED_KEY, 'term-7');
  });

  it('comes with the page\'s events reconnection signal as the runtime has it, for the Terminal tool to listen to: the screen does not subscribe to it itself', async () => {
    world.slots.set(PAGE_KEY_SLOT, JSON.stringify(SAVED_KEY));
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(drawn()?.terminals?.reconnect).toBe(onEventsReconnect);
    expect(onEventsReconnect).not.toHaveBeenCalled();
  });

  it('is handed to the host as one set of options for the life of the window, however often the screen is drawn', async () => {
    world.slots.set(PAGE_KEY_SLOT, JSON.stringify(SAVED_KEY));
    const view = render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    const before = world.given.length;
    world.inventory = { ...world.inventory, state: 'loading' };
    view.rerender(<PluginHostScreen />);
    expect(world.given.length).toBeGreaterThan(before);
    expect(new Set(world.given.map((props) => props.terminals)).size).toBe(1);
  });
});

describe('the way the screen gives the Terminal tool to open an address outside the app (T3a)', () => {
  it('is the runtime\'s browser call, which the host answers: it opens the address once for each call, and not before one is made', async () => {
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    const open = drawn()?.terminals?.openExternal;
    expect(open).toBeTypeOf('function');
    expect(Browser.OpenURL).not.toHaveBeenCalled();
    await open?.('https://example.com/docs');
    expect(Browser.OpenURL).toHaveBeenCalledTimes(1);
    expect(Browser.OpenURL).toHaveBeenCalledWith('https://example.com/docs');
    await open?.('http://localhost:3000');
    expect(Browser.OpenURL).toHaveBeenCalledTimes(2);
    expect(Browser.OpenURL).toHaveBeenLastCalledWith('http://localhost:3000');
  });

  it('lets the host\'s refusal through, for the Terminal tool to warn of: the screen swallows nothing and says nothing itself', async () => {
    const refused = new Error('the host does not open an address with a semicolon in it');
    vi.mocked(Browser.OpenURL).mockRejectedValue(refused);
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    await expect(drawn()?.terminals?.openExternal?.('https://example.com/a;b')).rejects.toBe(refused);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
