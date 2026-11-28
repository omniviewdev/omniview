import { Browser } from '@omniviewdev/runtime/runtime';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalsOptions } from '../../shell';
import type { TerminalChannels } from '../../shell/panel/terminal/channel';
import { attachLocalTerminal, localRestartTarget, restoreLocalTerminals } from '../../shell/panel/terminal/localShell';
import { loadAppTerminalChannels } from '../../shell/panel/terminal/terminalChannel';
import { PluginHostScreen } from './PluginHostScreen';
import type { PortForwardNetwork } from './portForward';

// What the screen of contributed pages gives the Terminal tool for a reload (#693 step 4): the terminal channels of the page, with the capabilities its window kept, read beside its session and its notifications; and a way to
// find the terminals the window left, and to attach one again, through those channels. The host is drawn once all three have been read, so that the terminals the window left are found from the first frame. Everything outside
// the screen is what the test says: the host's window service is a map of slots, the loader of the channels is a promise the test settles, and the host component records the props it was given.

type Inventory = { readonly plugins: readonly unknown[]; readonly state: 'ready' | 'loading' | 'failed'; readonly retry: () => void };

/** What the host is given, as far as these tests read it. */
type Given = { readonly terminals?: TerminalsOptions | undefined; readonly networker?: PortForwardNetwork | undefined };

const world = vi.hoisted(() => {
  const inventory: Inventory = { plugins: [], state: 'ready', retry: () => undefined };
  return {
    /** The slots of the window, as the host's window service keeps them. */
    slots: new Map<string, string>(),
    /** The props the host was given, in order. */
    given: [] as Given[],
    /** What the inventory says; a test changes it to have the screen drawn again. */
    inventory,
    /** The runtime's typed start of a forward, which the screen's networker calls through to. */
    start: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    /** The runtime's close of a forward by its id, which the screen's networker calls through to. */
    close: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    /** The host's opener (`openExternalURL` of the runtime's api), which the Terminal tool's way to open an address calls. */
    openExternal: vi.fn<(...args: unknown[]) => Promise<void>>(),
    /** The runtime's `Events.On`, which the screen's lifecycle listeners and its networker's closed feed subscribe through. */
    on: vi.fn<(name: string, callback: (event: { readonly data?: unknown }) => void) => () => void>(),
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
  // the host's opener: the screen gives the Terminal tool this one, never the runtime's own browser call
  openExternalURL: async (...args: unknown[]) => world.openExternal(...args),
  NetworkerClient: { StartResourcePortForwardingSession: async (...args: unknown[]) => world.start(...args), ClosePortForwardSession: async (...args: unknown[]) => world.close(...args) },
}));

vi.mock('@omniviewdev/runtime/runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Window: { Name: async () => Promise.resolve('main'), Close: async () => Promise.resolve() },
  Events: { On: (name: string, callback: (event: { readonly data?: unknown }) => void) => world.on(name, callback) },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the runtime names its browser call `OpenURL`
  Browser: { OpenURL: vi.fn() }, // a direct call of it is a failure of the tests below
}));

vi.mock('../../shell/panel/terminal/localShell', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), restoreLocalTerminals: vi.fn(), attachLocalTerminal: vi.fn(), localRestartTarget: vi.fn() }));
vi.mock('../../shell/panel/terminal/terminalChannel', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), loadAppTerminalChannels: vi.fn() }));

vi.mock('./useInstalledPlugins', () => ({ useInstalledPlugins: () => world.inventory }));

vi.mock('./PluginHost', () => ({
  PluginHost: (props: Given) => {
    world.given.push(props);
    return null;
  },
}));

const channels = { name: 'the channels of the page' } as unknown as TerminalChannels;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(restoreLocalTerminals).mockReset();
  vi.mocked(attachLocalTerminal).mockReset();
  vi.mocked(localRestartTarget).mockReset();
  vi.mocked(loadAppTerminalChannels).mockReset();
  vi.mocked(loadAppTerminalChannels).mockReturnValue(channels);
  vi.mocked(Browser.OpenURL).mockReset();
  world.openExternal.mockReset();
  world.start.mockReset();
  world.close.mockReset();
  world.on.mockReset();
  world.on.mockImplementation(() => () => undefined);
  vi.mocked(Browser.OpenURL).mockResolvedValue(undefined);
  world.openExternal.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  world.slots.clear();
  world.given.length = 0;
  world.inventory = { plugins: [], state: 'ready', retry: () => undefined };
});

/** What the host was given when it was drawn last. */
const drawn = (): Given | undefined => world.given.at(-1);

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

  it('come as a way to find the terminals the window left, a way to attach one again, a way to start an ended one again, and the way to open a link, and nothing else: no page key, no reconnection signal', async () => {
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(Object.keys(drawn()?.terminals ?? {}).sort()).toEqual(['openExternal', 'reattach', 'restart', 'restore']);
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

  it('are what the way to start an ended terminal again makes its target through, with the page\'s channels, when it is asked and not before (#695 step 5)', async () => {
    const target = { plugin: 'host', id: 'local', title: 'Terminal', sessionId: 'tab-3', open: vi.fn() };
    vi.mocked(localRestartTarget).mockReturnValue(target);
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    expect(localRestartTarget).not.toHaveBeenCalled();
    const made = { id: 'old', command: ['/bin/zsh'] };
    expect(drawn()?.terminals?.restart?.(made, 'tab-3')).toBe(target);
    expect(localRestartTarget).toHaveBeenCalledTimes(1);
    expect(localRestartTarget).toHaveBeenCalledWith(made, 'tab-3', channels);
  });

  it('carry what the lost terminal was asked to start with into the terminal it attaches again, so that a restart after a take-back keeps the environment and the arguments (#695 step 5)', async () => {
    vi.mocked(attachLocalTerminal).mockReturnValue({ plugin: 'host', id: 'local', title: 'zsh', sessionId: 'term-7', open: vi.fn() });
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    const launch = { command: ['/bin/zsh', '-f'], env: { A: '1' } };
    drawn()?.terminals?.reattach?.('term-7', { launch: () => launch } as never);
    expect(attachLocalTerminal).toHaveBeenCalledWith('term-7', undefined, channels, { launch });
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
  it('is the host\'s opener, which checks the address and answers: it opens the address once for each call, and not before one is made', async () => {
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    const open = drawn()?.terminals?.openExternal;
    expect(open).toBeTypeOf('function');
    expect(world.openExternal).not.toHaveBeenCalled();
    await open?.('https://example.com/docs');
    expect(world.openExternal).toHaveBeenCalledTimes(1);
    expect(world.openExternal).toHaveBeenCalledWith('https://example.com/docs');
    await open?.('http://localhost:3000');
    expect(world.openExternal).toHaveBeenCalledTimes(2);
    expect(world.openExternal).toHaveBeenLastCalledWith('http://localhost:3000');
    expect(Browser.OpenURL).not.toHaveBeenCalled();
  });

  it('lets the host\'s refusal through, for the Terminal tool to warn of: the screen swallows nothing and says nothing itself', async () => {
    const refused = new Error('the host does not open an address with a semicolon in it');
    world.openExternal.mockRejectedValue(refused);
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    await expect(drawn()?.terminals?.openExternal?.('https://example.com/a;b')).rejects.toBe(refused);
    expect(console.warn).not.toHaveBeenCalled();
    expect(Browser.OpenURL).not.toHaveBeenCalled();
  });
});

describe('the way the screen gives the host to reach the networker for a port forward (PF1)', () => {
  const options = {
    local_port: 0,
    remote_port: 8080,
    protocol: 'TCP',
    connection_type: 'RESOURCE',
    connection: { plugin_id: 'acme', connection_id: 'north', resource_id: 'alpha', resource_key: 'widgets' },
  } as const;

  /** The networker the screen gave the host, once the host was drawn. */
  async function networkerGiven(): Promise<PortForwardNetwork> {
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    const networker = drawn()?.networker;
    if (networker === undefined) {
      throw new Error('the host was given no networker');
    }

    return networker;
  }

  it('starts through the runtime\'s typed start, as it is: the plugin and the connection are its routing, the request its options, and nothing is asked before a call is made', async () => {
    const started = { id: 'forward-1', local_port: 41_234 };
    world.start.mockResolvedValue(started);
    const { start } = await networkerGiven();
    expect(start).toBeTypeOf('function');
    expect(world.start).not.toHaveBeenCalled();
    await expect(start('acme', 'north', options)).resolves.toBe(started);
    expect(world.start).toHaveBeenCalledTimes(1);
    expect(world.start).toHaveBeenCalledWith('acme', 'north', options);
  });

  it('lets the host\'s refusal of a start through as it came, for the forward to word: the screen swallows nothing and says nothing itself', async () => {
    const refused = new Error('the host did not answer');
    world.start.mockRejectedValue(refused);
    const { start } = await networkerGiven();
    await expect(start('acme', 'north', options)).rejects.toBe(refused);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('stops through the runtime\'s close of a forward, by its id, as it is: nothing is asked before a call is made, and the session the host answers is not the window\'s to read', async () => {
    world.close.mockResolvedValue({ id: 'forward-1', state: 'STOPPED' });
    const { stop } = await networkerGiven();
    expect(stop).toBeTypeOf('function');
    expect(world.close).not.toHaveBeenCalled();
    await expect(stop('forward-1')).resolves.toBeUndefined();
    expect(world.close).toHaveBeenCalledTimes(1);
    expect(world.close).toHaveBeenCalledWith('forward-1');
    expect(world.start).not.toHaveBeenCalled();
  });

  it('lets the host\'s refusal of a stop through as it came, for the forward to word: the screen swallows nothing and says nothing itself', async () => {
    const refused = new Error('the host did not answer');
    world.close.mockRejectedValue(refused);
    const { stop } = await networkerGiven();
    await expect(stop('forward-1')).rejects.toBe(refused);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('is one networker for the life of the window, however often the screen is drawn', async () => {
    const view = render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    const before = world.given.length;
    world.inventory = { ...world.inventory, state: 'loading' };
    view.rerender(<PluginHostScreen />);
    expect(world.given.length).toBeGreaterThan(before);
    expect(drawn()?.networker).toBeDefined();
    expect(new Set(world.given.map((props) => props.networker)).size).toBe(1);
  });
});

// PF2: the networker's word that a forward is closed is the host's event of that name, heard through the runtime. The screen subscribes to it only when the host asks for it (the window asks while it counts a forward), and it
// gives the host the id of the forward that was closed and nothing else: what the event carries beyond it is the Ports tool's to read.
describe('the closed events the screen gives the host\'s count of forwards (PF2)', () => {
  const CLOSED = 'core/networker/portforward/closed';

  /** The networker the screen gave the host. */
  async function networkerGiven(): Promise<PortForwardNetwork> {
    render(<PluginHostScreen />);
    await waitFor(() => {
      expect(world.given.length).toBeGreaterThan(0);
    });
    const networker = drawn()?.networker;
    if (networker === undefined) {
      throw new Error('the host was given no networker');
    }

    return networker;
  }

  /** The callbacks the runtime was given for the closed event, in order. */
  const closedHandlers = () => world.on.mock.calls.filter(([name]) => name === CLOSED).map(([, callback]) => callback);

  it('are not listened to until the host asks: the screen subscribes to nothing of the host\'s forwards by itself', async () => {
    await networkerGiven();
    expect(closedHandlers()).toHaveLength(0);
  });

  it('are listened to through the runtime when the host asks, once for each ask, and give the host the id of the forward that was closed', async () => {
    const { onClosed } = await networkerGiven();
    const closed: string[] = [];
    onClosed((sessionId) => {
      closed.push(sessionId);
    });
    expect(closedHandlers()).toHaveLength(1);
    closedHandlers()[0]?.({ data: { id: 'forward-7', state: 'STOPPED', local_port: 41_234 } });
    expect(closed).toEqual(['forward-7']);
  });

  it.each([
    ['no payload', {}],
    ['a payload that is nothing', { data: null }],
    ['a payload that is text', { data: 'forward-7' }],
    ['a payload with no id', { data: { state: 'STOPPED' } }],
    ['a payload whose id is not text', { data: { id: 7 } }],
    ['a payload whose id is empty', { data: { id: '' } }],
  ])('does not tell the host of an event with %s: there is no forward to say it was closed', async (_name, event) => {
    const { onClosed } = await networkerGiven();
    const closed: string[] = [];
    onClosed((sessionId) => {
      closed.push(sessionId);
    });
    closedHandlers()[0]?.(event);
    expect(closed).toEqual([]);
  });

  it('stops listening with the function the runtime answered, when the host says so, and not before', async () => {
    const unsubscribe = vi.fn();
    world.on.mockImplementation((name) => (name === CLOSED ? unsubscribe : () => undefined));
    const { onClosed } = await networkerGiven();
    const stop = onClosed(() => undefined);
    expect(unsubscribe).not.toHaveBeenCalled();
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
