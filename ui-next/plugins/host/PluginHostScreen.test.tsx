import { Browser } from '@omniviewdev/runtime/runtime';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalsOptions } from '../../shell';
import type { TerminalChannels } from '../../shell/panel/terminal/channel';
import { attachLocalTerminal, restoreLocalTerminals } from '../../shell/panel/terminal/localShell';
import { loadAppTerminalChannels } from '../../shell/panel/terminal/terminalChannel';
import { PluginHostScreen } from './PluginHostScreen';

// What the screen of contributed pages gives the Terminal tool for a reload (#693 step 4): the terminal channels of the page, with the capabilities its window kept, read beside its session and its notifications; and a way to
// find the terminals the window left, and to attach one again, through those channels. The host is drawn once all three have been read, so that the terminals the window left are found from the first frame. Everything outside
// the screen is what the test says: the host's window service is a map of slots, the loader of the channels is a promise the test settles, and the host component records the props it was given.

type Inventory = { readonly plugins: readonly unknown[]; readonly state: 'ready' | 'loading' | 'failed'; readonly retry: () => void };

const world = vi.hoisted(() => {
  const inventory: Inventory = { plugins: [], state: 'ready', retry: () => undefined };
  return {
    /** The slots of the window, as the host's window service keeps them. */
    slots: new Map<string, string>(),
    /** The props the host was given, in order. */
    given: [] as Array<{ readonly terminals?: TerminalsOptions | undefined }>,
    /** What the inventory says; a test changes it to have the screen drawn again. */
    inventory,
  };
});

vi.mock('@omniviewdev/runtime/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WindowClient: {
    GetState: async () => Promise.resolve(Object.fromEntries(world.slots)),
    SaveState: async (_name: string, slot: string, json: string) => {
      world.slots.set(slot, json);
      return Promise.resolve();
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
}));

vi.mock('../../shell/panel/terminal/localShell', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), restoreLocalTerminals: vi.fn(), attachLocalTerminal: vi.fn() }));
vi.mock('../../shell/panel/terminal/terminalChannel', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), loadAppTerminalChannels: vi.fn() }));

vi.mock('./useInstalledPlugins', () => ({ useInstalledPlugins: () => world.inventory }));

vi.mock('./PluginHost', () => ({
  PluginHost: (props: { readonly terminals?: TerminalsOptions | undefined }) => {
    world.given.push(props);
    return null;
  },
}));

const channels = { name: 'the channels of the page' } as unknown as TerminalChannels;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(restoreLocalTerminals).mockReset();
  vi.mocked(attachLocalTerminal).mockReset();
  vi.mocked(loadAppTerminalChannels).mockReset();
  vi.mocked(loadAppTerminalChannels).mockReturnValue(channels);
  vi.mocked(Browser.OpenURL).mockReset();
  vi.mocked(Browser.OpenURL).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  world.slots.clear();
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

describe('the terminal channels the screen gives the Terminal tool', () => {
  it('are loaded from the tab\'s storage once, before the host is drawn, and the host is drawn with them', async () => {
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(loadAppTerminalChannels).toHaveBeenCalledTimes(1);
  });

  it('come as a way to find the terminals the window left and a way to attach one again, and the way to open a link, and nothing else: no page key, no reconnection signal', async () => {
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(Object.keys(drawn()?.terminals ?? {}).sort()).toEqual(['openExternal', 'reattach', 'restore']);
  });

  it('are what the way to find the terminals the window left asks, when it is asked and not before', async () => {
    const found = [{ plugin: 'host', id: 'local', title: 'zsh', sessionId: 'term-1', open: vi.fn() }];
    vi.mocked(restoreLocalTerminals).mockResolvedValue(found);
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(restoreLocalTerminals).not.toHaveBeenCalled();
    await expect(drawn()?.terminals?.restore?.()).resolves.toBe(found);
    expect(restoreLocalTerminals).toHaveBeenCalledTimes(1);
    expect(restoreLocalTerminals).toHaveBeenCalledWith(channels);
  });

  it('are what the way to attach a terminal again attaches through, when it is asked and not before', async () => {
    const target = { plugin: 'host', id: 'local', title: 'zsh', sessionId: 'term-7', open: vi.fn() };
    vi.mocked(attachLocalTerminal).mockReturnValue(target);
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(attachLocalTerminal).not.toHaveBeenCalled();
    expect(drawn()?.terminals?.reattach?.('term-7')).toBe(target);
    expect(attachLocalTerminal).toHaveBeenCalledTimes(1);
    expect(attachLocalTerminal).toHaveBeenCalledWith('term-7', undefined, channels);
  });

  it('keep the window\'s slots as they were: the screen writes none for the terminals, which the channels keep themselves', async () => {
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect([...world.slots.keys()]).not.toContain('terminal-page-key');
  });

  it('are handed to the host as one set of options for the life of the window, however often the screen is drawn', async () => {
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
