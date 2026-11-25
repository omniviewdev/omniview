import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, PORTS_TOOL, PORTS_TOOL_ID, type PanelStore } from '../../shell';
import type { ContextV1, PanelHostV1, PortForwardErrorV1, SidebarContextV1 } from '../contract/v1';
import { unloadedFailure } from '../loader/failure';
import { acme, answering, startedOn, widgetPage, WIDGETS } from '../testing';
import type { ConnectionsApi, StateRecord } from './connections/api';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import type { PortForwardNetwork, PortForwardStart, PortForwardStop } from './portForward';
import { ledgerWorld, type LedgerWorld } from './portTesting';
import { NO_ROUTE, type HostRoute } from './route';

// What a page forwards a port with (PF1), through the real window and against an invented plugin (Acme): the host hands the page's hook and the sidebar's hook a `ctx.panel` whose `ports.forward` starts the forward in the
// plugin and the connection the page is read in, and no other, answers a forward the page can stop, says a refusal in the host's code, and shows the Ports tool once a forward started. The rules of a forward are in
// `portForward.test.ts` and the handle's in `panelHost.test.ts`; what is under test here is that they are wired into the window: the right plugin and connection reach the networker's start, and the stop reaches its close,
// from every place a plugin is given the handle. The networker is a fake.

type Seen = {
  page: ContextV1[];
  sidebar: SidebarContextV1[];
  /** Makes the page's own hook run again, as a state of its own does: the latest the page gave. */
  render: (() => void) | undefined;
};

const link = (connection?: string): HostRoute => ({ plugin: 'acme', page: 'widgets', connection, params: {} });

const request = { resourceId: 'alpha', resourceKey: 'widgets', remotePort: 8080, localPort: 9090 };

type Networker = {
  readonly start: Mock<PortForwardStart>;
  readonly stop: Mock<PortForwardStop>;
  readonly onClosed: PortForwardNetwork['onClosed'];
  /** The host's closed events, as the test says them. */
  readonly world: LedgerWorld;
};

/** The host's networker as the window is given it: it starts a forward on port 9090 and closes what it is asked to, unless a test says otherwise, and the host's word that a forward is closed is the test's. */
function networking(start: PortForwardStart = async () => Promise.resolve({ id: 'forward-1', local_port: 9090 })): Networker {
  const world = ledgerWorld();
  return { start: vi.fn<PortForwardStart>(start), stop: vi.fn<PortForwardStop>(async () => Promise.resolve(undefined)), onClosed: world.deps.onClosed, world };
}

/** A networker that starts a forward of its own each time it is asked. */
function numbering(): Networker {
  let issued = 0;
  return networking(async () => {
    issued += 1;
    return Promise.resolve({ id: `forward-${String(issued)}`, local_port: 40_000 + issued });
  });
}

type Listed = Readonly<Record<string, readonly StateRecord[]>>;

/** What the host lists for the plugin when it has these connections, all connected: none is an answer with no entry for the plugin. */
const known = (...ids: readonly string[]): Listed => (ids.length === 0 ? {} : { acme: ids.map((id): StateRecord => ({ connection: { id, name: id }, readiness: 'CONNECTED' })) });

/** The host's list of connections as a test says it: what the window reads, how often it has read, and the host telling the window that something changed (the store reads again a moment after the first of a burst). */
function listing(initial: Listed) {
  let answer = initial;
  let reads = 0;
  const heard = new Set<() => void>();
  const api: ConnectionsApi = {
    states: async () => {
      reads += 1;
      return Promise.resolve(answer);
    },
    start: async () => Promise.resolve({ status: 'CONNECTED' }),
    onStatus: (listener) => {
      heard.add(listener);
      return () => {
        heard.delete(listener);
      };
    },
    onSync: () => () => undefined,
  };
  return {
    api,
    reads: () => reads,
    change: (next: Listed) => {
      answer = next;
      for (const listener of [...heard]) {
        listener();
      }
    },
  };
}

/** The plugins of the window as a test changes them: what the store holds, and how many listeners are on it. */
function changing(initial: readonly PluginEntry[]) {
  let entries = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: readonly PluginEntry[]) => {
      entries = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listeners: () => listeners.size,
  };
}

type MountOptions = {
  readonly link?: HostRoute;
  readonly networker?: PortForwardNetwork | undefined;
  /** What the window knows of the plugin's connections: absent, the window has no connection data. */
  readonly connections?: ConnectionsApi | undefined;
  /** Whether a user action is under way, as the window is told: inside one unless the test says otherwise. `'window'` gives the host no reading, so that it asks the window's own engine. */
  readonly userActivation?: (() => boolean | undefined) | 'window';
};

function mount(options: MountOptions = {}) {
  const seen: Seen = { page: [], sidebar: [], render: undefined };
  const panel: PanelStore = createPanelStore();
  // The Ports tool is the window's own, registered with the others: it is what a forward that started shows.
  panel.registerTool(PORTS_TOOL);
  const contribution = acme({
    pages: {
      widgets: widgetPage('Widgets', (context) => {
        const [, setRenders] = useState(0);
        seen.page.push(context);
        seen.render = () => {
          setRenders((renders) => renders + 1);
        };

        return answering(WIDGETS)(context);
      }),
    },
    sidebar: {
      ...acme().sidebar,
      useNodes: (context) => {
        seen.sidebar.push(context);
        return undefined;
      },
    },
  });
  const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution }];
  const plugins = changing(entries);
  // A window opened on a link has no session of its own: the link opens its first tab. Any other starts from a session with one tab, in no connection.
  const props: PluginHostProps = {
    plugins,
    inventory: 'ready',
    link: options.link ?? NO_ROUTE,
    onRetry: () => undefined,
    onRetryInventory: () => undefined,
    panel,
    session: options.link === undefined ? startedOn(entries) : undefined,
    networker: options.networker,
    connections: options.connections,
    userActivation: options.userActivation === 'window' ? undefined : (options.userActivation ?? (() => true)),
  };
  const view = render(<PluginHost {...props} />);
  return {
    ...view,
    panel,
    seen,
    plugins,
    entries,
    /** The window is drawn again with the props it had: what a render of the host is, with nothing changed. */
    again: () => {
      view.rerender(<PluginHost {...props} />);
    },
  };
}

/** The handle the page was given. The page runs after the first frames, so a test waits for it. */
async function handle(seen: Seen): Promise<PanelHostV1> {
  await waitFor(() => {
    expect(seen.page.at(-1)?.panel).toBeDefined();
  });
  const found = seen.page.at(-1)?.panel;
  if (found === undefined) {
    throw new Error('the page was given no panel handle');
  }

  return found;
}

/** The ports member of a handle, for a test that has said it is there. */
function portsOf(panel: PanelHostV1): NonNullable<PanelHostV1['ports']> {
  const { ports } = panel;
  if (ports === undefined) {
    throw new Error('the handle has no ports member');
  }

  return ports;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'userActivation');
  vi.restoreAllMocks();
});

describe('a page that is read in a connection', () => {
  it('forwards in its own plugin and its own connection: the networker is told the page\'s scope, which the request does not name, and the answer is the forward', async () => {
    const networker = networking();
    const { seen } = mount({ link: link('north'), networker });
    const ports = portsOf(await handle(seen));
    let answer: unknown;
    await act(async () => {
      answer = await ports.forward(request);
    });
    expect(answer).toStrictEqual({ sessionId: 'forward-1', localPort: 9090, stop: expect.any(Function) });
    expect(networker.start).toHaveBeenCalledTimes(1);
    expect(networker.start.mock.calls[0]).toStrictEqual([
      'acme',
      'north',
      {
        local_port: 9090,
        remote_port: 8080,
        protocol: 'TCP',
        connection_type: 'RESOURCE',
        connection: { plugin_id: 'acme', connection_id: 'north', resource_id: 'alpha', resource_key: 'widgets' },
      },
    ]);
  });

  it('gives the sidebar\'s hook a handle that forwards in the connection of the route the sidebar is read in', async () => {
    const networker = networking();
    const { seen } = mount({ link: link('north'), networker });
    await waitFor(() => {
      expect(seen.sidebar.at(-1)?.panel?.ports).toBeDefined();
    });
    await act(async () => {
      await seen.sidebar.at(-1)?.panel?.ports?.forward(request);
    });
    expect(networker.start.mock.calls.map(([plugin, connection]) => [plugin, connection])).toEqual([['acme', 'north']]);
  });

  it('stops the forward through the networker when the page stops it: the close is asked for the forward\'s id and for no other, once', async () => {
    const networker = networking();
    const { seen } = mount({ link: link('north'), networker });
    const ports = portsOf(await handle(seen));
    await act(async () => {
      const answer = await ports.forward(request);
      expect(networker.stop).not.toHaveBeenCalled();
      await answer.stop();
      await answer.stop();
    });
    expect(networker.stop.mock.calls).toEqual([['forward-1']]);
  });

  it('shows the Ports tool for the forward that started, and shows nothing for one the host refused', async () => {
    let refuse = true;
    const networker = networking(async () => (refuse ? Promise.reject(new Error('the host did not answer')) : Promise.resolve({ id: 'forward-1', local_port: 9090 })));
    const { seen, panel } = mount({ link: link('north'), networker });
    const ports = portsOf(await handle(seen));
    expect(panel.getSnapshot().open).toBe(false);

    await act(async () => {
      await expect(ports.forward(request)).rejects.toThrow('The operation could not be completed.');
    });
    expect(panel.getSnapshot().open).toBe(false);

    refuse = false;
    await act(async () => {
      await ports.forward(request);
    });
    expect(panel.getSnapshot()).toMatchObject({ open: true, tool: PORTS_TOOL_ID });
  });

  it('says a refusal in the host\'s own code: an error named for it, which the page tells by its name and reads by its code, with the host\'s error as its cause', async () => {
    const host = { code: 'PROVIDER_ERROR', title: '', message: 'port 9090 is unavailable' };
    const rejection = new Error(JSON.stringify(host), { cause: host });
    const networker = networking(async () => Promise.reject(rejection));
    const { seen } = mount({ link: link('north'), networker });
    const ports = portsOf(await handle(seen));
    let caught: unknown;
    await act(async () => {
      caught = await ports.forward(request).catch((error: unknown) => error);
    });
    expect(caught).toBeInstanceOf(Error);
    // What the contract says a plugin is rejected with: the page cannot import the class, so it reads the error as the contract's type once it has told it by its name.
    const refusal = caught as PortForwardErrorV1;
    expect(refusal.name).toBe('PortForwardError');
    expect(refusal.code).toBe('PROVIDER_ERROR');
    expect(refusal.message).toBe('The provider could not complete the operation.');
    expect(refusal.cause).toBe(rejection);
  });

  it('gives the page\'s hook the handle it was given when the page is drawn again in the same connection: a hook may list it among its dependencies', async () => {
    const { seen } = mount({ link: link('north'), networker: networking() });
    const first = await handle(seen);
    expect(first.ports).toBeDefined();

    // The page's own state changes, so its hook runs again, in the same connection. That is what a render of the page is: the cache of handles is proved below, for the hook the host draws itself, and in `panelHost.test.ts`.
    const ran = seen.page.length;
    act(() => {
      seen.render?.();
    });
    expect(seen.page.length).toBeGreaterThan(ran);
    expect(seen.page.at(-1)?.panel).toBe(first);
  });

  it('gives the sidebar\'s hook the handle it was given when the window is drawn again: the handle is made once for the plugin and the connection, and not for each render', async () => {
    const { seen, again } = mount({ link: link('north'), networker: networking() });
    await waitFor(() => {
      expect(seen.sidebar.at(-1)?.panel?.ports).toBeDefined();
    });
    const first = seen.sidebar.at(-1)?.panel;

    // The window is drawn again with nothing changed: the host draws the sidebar's hook itself, so it runs again, in the same connection.
    const ran = seen.sidebar.length;
    act(() => {
      again();
    });
    expect(seen.sidebar.length).toBeGreaterThan(ran);
    expect(seen.sidebar.at(-1)?.panel).toBe(first);
  });
});

describe('a page that is read in no connection', () => {
  it('is given a handle with no ports member, as a host that predates it is: nothing says which connection to forward in, and a member that always refuses is worse than none', async () => {
    const networker = networking();
    const { seen, panel } = mount({ networker });
    const given = await handle(seen);
    expect(seen.page.at(-1)?.route.connection).toBeUndefined();
    expect(given.ports).toBeUndefined();
    expect(given.logs.open).toBeTypeOf('function');
    expect(networker.start).not.toHaveBeenCalled();
    expect(panel.getSnapshot().open).toBe(false);
  });
});

// PF3. A route of a plugin that has one connection names none (`complete`: there is nothing to choose between) and the plugin reads it in that one, so the window knows which connection the page is read in and gives it the ports member:
// without it a window of one cluster could forward no port from any page. Two or more connections with the route naming none, none at all, or a list the window has not read: nothing says which one, and the page has no ports member.
describe('a page whose route names no connection, in a window that knows the plugin\'s connections (PF3)', () => {
  /** Lets the window read the host's list (asked for at the mount) and draw what it came to. */
  async function settled(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it('is read in the plugin\'s only connection: the page and the sidebar have the ports member, and a forward starts in that connection', async () => {
    const networker = numbering();
    const { seen } = mount({ connections: listing(known('north')).api, networker });
    await waitFor(() => {
      expect(seen.page.at(-1)?.panel?.ports).toBeDefined();
      expect(seen.sidebar.at(-1)?.panel?.ports).toBeDefined();
    });
    expect(seen.page.at(-1)?.route.connection).toBeUndefined();
    await act(async () => {
      await seen.page.at(-1)?.panel?.ports?.forward(request);
      await seen.sidebar.at(-1)?.panel?.ports?.forward(request);
    });
    expect(networker.start.mock.calls.map(([plugin, connection]) => [plugin, connection])).toEqual([
      ['acme', 'north'],
      ['acme', 'north'],
    ]);
  });

  it.each([
    ['two connections', listing(known('north', 'south'))],
    ['no connection', listing(known())],
  ])('is given no ports member when the plugin has %s: nothing says which one it is read in', async (_name, hosting) => {
    const { seen } = mount({ connections: hosting.api, networker: networking() });
    await settled();
    expect(hosting.reads()).toBeGreaterThanOrEqual(1);
    expect(seen.page.at(-1)?.panel?.logs.open).toBeTypeOf('function');
    expect(seen.page.at(-1)?.panel?.ports).toBeUndefined();
    expect(seen.sidebar.at(-1)?.panel?.ports).toBeUndefined();
  });

  it('is given no ports member while the window has not read the list', async () => {
    const api: ConnectionsApi = { ...listing(known('north')).api, states: async () => new Promise<Listed>(() => undefined) };
    const { seen } = mount({ connections: api, networker: networking() });
    await settled();
    expect(seen.page.at(-1)?.panel?.logs.open).toBeTypeOf('function');
    expect(seen.page.at(-1)?.panel?.ports).toBeUndefined();
  });

  it('is read in the connection its route names, as before, whatever the plugin has', async () => {
    for (const listed of [known('north', 'south'), known('south'), known()]) {
      const networker = networking();
      const { seen, unmount } = mount({ link: link('north'), connections: listing(listed).api, networker });
      const ports = portsOf(await handle(seen));
      await act(async () => {
        await ports.forward(request);
      });
      expect(networker.start.mock.calls.map(([plugin, connection]) => [plugin, connection])).toEqual([['acme', 'north']]);
      unmount();
    }
  });

  it('follows the plugin\'s connections while the page is open: the only one replaced, removed, joined by a second, and alone again', async () => {
    const networker = numbering();
    const hosting = listing(known('north'));
    const { seen } = mount({ connections: hosting.api, networker });
    const forwardedIn = async (): Promise<unknown> => {
      await act(async () => {
        await seen.page.at(-1)?.panel?.ports?.forward(request);
      });
      return networker.start.mock.calls.at(-1)?.[1];
    };

    await waitFor(() => {
      expect(seen.page.at(-1)?.panel?.ports).toBeDefined();
    });
    expect(await forwardedIn()).toBe('north');

    // Replaced: the one connection is another one now, and the page forwards in it.
    const north = seen.page.at(-1)?.panel?.ports;
    hosting.change(known('south'));
    await waitFor(() => {
      expect(seen.page.at(-1)?.panel?.ports).toBeDefined();
      expect(seen.page.at(-1)?.panel?.ports).not.toBe(north);
      expect(seen.sidebar.at(-1)?.panel?.ports).toBe(seen.page.at(-1)?.panel?.ports);
    });
    expect(await forwardedIn()).toBe('south');

    // Removed: none, and the page and the sidebar have no member to call.
    hosting.change(known());
    await waitFor(() => {
      expect(seen.page.at(-1)?.panel?.ports).toBeUndefined();
      expect(seen.sidebar.at(-1)?.panel?.ports).toBeUndefined();
    });

    // Joined by a second: two connections and a route that names none, so none, and the window read the list before it said so.
    const before = hosting.reads();
    hosting.change(known('south', 'west'));
    await waitFor(() => {
      expect(hosting.reads()).toBe(before + 1);
    });
    await settled();
    expect(seen.page.at(-1)?.panel?.ports).toBeUndefined();

    // Alone again.
    hosting.change(known('west'));
    await waitFor(() => {
      expect(seen.page.at(-1)?.panel?.ports).toBeDefined();
    });
    expect(await forwardedIn()).toBe('west');
  });
});

describe('a window with no port-forward service', () => {
  it('gives its pages a handle with no ports member, as a host that predates it does: the Logs member is as it was', async () => {
    const { seen } = mount({ link: link('north') });
    const panel = await handle(seen);
    expect(panel.ports).toBeUndefined();
    expect(panel.logs.open).toBeTypeOf('function');
  });
});

// PF2: through the window. A forward is started from a user action only, and the window is told whether one is under way by the reading it is given, or, when it is given none, by its own engine (`navigator.userActivation`).
describe('a forward asked in the window (PF2)', () => {
  const OUTSIDE = 'A forward can only be started from a user action: a click or a key press.';
  const UNKNOWN = 'This window cannot tell a user action from a script, so it cannot start a forward.';

  /** What a call rejects with, inside the act that lets the window settle. */
  async function refusedWith(ports: NonNullable<PanelHostV1['ports']>): Promise<unknown> {
    let caught: unknown;
    await act(async () => {
      caught = await ports.forward(request).catch((error: unknown) => error);
    });
    return caught;
  }

  it('is refused outside a user action: FORBIDDEN, the networker is not asked and the Ports tool is not shown', async () => {
    const networker = networking();
    const { seen, panel } = mount({ link: link('north'), networker, userActivation: () => false });
    const ports = portsOf(await handle(seen));
    expect(await refusedWith(ports)).toMatchObject({ name: 'PortForwardError', code: 'FORBIDDEN', message: OUTSIDE });
    expect(networker.start).not.toHaveBeenCalled();
    expect(panel.getSnapshot().open).toBe(false);
  });

  it('asks the window\'s own engine when it is given no reading, and an engine that cannot tell refuses: the test environment has no `navigator.userActivation`', async () => {
    const networker = networking();
    const { seen } = mount({ link: link('north'), networker, userActivation: 'window' });
    const ports = portsOf(await handle(seen));
    expect(Reflect.get(navigator, 'userActivation')).toBeUndefined();
    expect(await refusedWith(ports)).toMatchObject({ name: 'PortForwardError', code: 'FORBIDDEN', message: UNKNOWN });
    expect(networker.start).not.toHaveBeenCalled();
  });

  it('forwards when the window\'s own engine says a user action is under way, and is refused when it says none is: the engine is asked at each call', async () => {
    const engine = { isActive: true, hasBeenActive: true };
    Object.defineProperty(navigator, 'userActivation', { value: engine, configurable: true });
    const networker = networking();
    const { seen } = mount({ link: link('north'), networker, userActivation: 'window' });
    const ports = portsOf(await handle(seen));
    await act(async () => {
      await ports.forward(request);
    });
    expect(networker.start).toHaveBeenCalledTimes(1);
    engine.isActive = false;
    expect(await refusedWith(ports)).toMatchObject({ code: 'FORBIDDEN', message: OUTSIDE });
    expect(networker.start).toHaveBeenCalledTimes(1);
  });
});

// PF2: the count of the forwards the window has started is the window's, and what it listens to is wired here: the networker's closed events, and the window's own store for a plugin that stops.
describe('the forwards the window counts (PF2)', () => {
  /** Forwards `count` times in the window, and answers what the page was given. */
  async function forwardTimes(ports: NonNullable<PanelHostV1['ports']>, count: number) {
    const answers: Array<Awaited<ReturnType<NonNullable<PanelHostV1['ports']>['forward']>>> = [];
    await act(async () => {
      for (let one = 0; one < count; one += 1) {
        answers.push(await ports.forward(request));
      }
    });
    return answers;
  }

  /** The window refuses the next forward because the connection holds as many as it may. */
  async function isFull(ports: NonNullable<PanelHostV1['ports']>): Promise<void> {
    await act(async () => {
      await expect(ports.forward(request)).rejects.toMatchObject({ name: 'PortForwardError', code: 'RESOURCE_LIMIT', limit: 64 });
    });
  }

  it('listens to the host\'s closed events, and to the window\'s plugins, only while it holds a forward', async () => {
    const networker = numbering();
    const { seen, plugins } = mount({ link: link('north'), networker });
    const ports = portsOf(await handle(seen));
    const idle = plugins.listeners();
    expect(networker.world.listening().closed).toBe(0);
    const [answer] = await forwardTimes(ports, 1);
    expect(networker.world.listening().closed).toBe(1);
    expect(plugins.listeners()).toBe(idle + 1);
    await act(async () => {
      await answer?.stop();
    });
    expect(networker.world.listening().closed).toBe(0);
    expect(plugins.listeners()).toBe(idle);
  });

  it('gives a place back when the host says a forward is closed: the networker\'s closed events reach the count', async () => {
    const networker = numbering();
    const { seen } = mount({ link: link('north'), networker });
    const ports = portsOf(await handle(seen));
    const answers = await forwardTimes(ports, 64);
    await isFull(ports);
    networker.world.closed(answers[3]?.sessionId ?? '');
    await forwardTimes(ports, 1);
    await isFull(ports);
    expect(networker.start).toHaveBeenCalledTimes(65);
  });

  it('gives back the places of a plugin that stops, as the window\'s own store says it: the host says nothing of the forwards of a plugin that stopped', async () => {
    const networker = numbering();
    const { seen, plugins, entries } = mount({ link: link('north'), networker });
    const ports = portsOf(await handle(seen));
    await forwardTimes(ports, 64);
    await isFull(ports);
    act(() => {
      plugins.set([{ id: 'acme', name: 'Acme plugin', phase: 'failed', failure: unloadedFailure('failed') }]);
    });
    act(() => {
      plugins.set(entries);
    });
    await forwardTimes(ports, 64);
    await isFull(ports);
  });

  it('keeps the places of a plugin that still runs when the window\'s plugins change', async () => {
    const networker = numbering();
    const { seen, plugins, entries } = mount({ link: link('north'), networker });
    const ports = portsOf(await handle(seen));
    await forwardTimes(ports, 64);
    act(() => {
      plugins.set([...entries, { id: 'beta', name: 'Beta plugin', phase: 'loading' }]);
    });
    await isFull(ports);
  });
});
