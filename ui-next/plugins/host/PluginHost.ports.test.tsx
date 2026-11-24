import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, PORTS_TOOL, PORTS_TOOL_ID, type PanelStore } from '../../shell';
import type { ContextV1, PanelHostV1, PortForwardErrorV1, SidebarContextV1 } from '../contract/v1';
import { acme, answering, startedOn, widgetPage, WIDGETS } from '../testing';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import type { PortForwardNetwork, PortForwardStart, PortForwardStop } from './portForward';
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

type Networker = { readonly start: Mock<PortForwardStart>; readonly stop: Mock<PortForwardStop> };

/** The host's networker as the window is given it: it starts a forward on port 9090 and closes what it is asked to, unless a test says otherwise. */
function networking(start: PortForwardStart = async () => Promise.resolve({ id: 'forward-1', local_port: 9090 })): Networker {
  return { start: vi.fn<PortForwardStart>(start), stop: vi.fn<PortForwardStop>(async () => Promise.resolve(undefined)) };
}

function mount(options: { readonly link?: HostRoute; readonly networker?: PortForwardNetwork | undefined } = {}) {
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
  const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };
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
  };
  const view = render(<PluginHost {...props} />);
  return {
    ...view,
    panel,
    seen,
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
    expect(answer).toStrictEqual({ sessionId: 'forward-1', localPort: 9090, localHost: '127.0.0.1', stop: expect.any(Function) });
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

describe('a window with no port-forward service', () => {
  it('gives its pages a handle with no ports member, as a host that predates it does: the Logs member is as it was', async () => {
    const { seen } = mount({ link: link('north') });
    const panel = await handle(seen);
    expect(panel.ports).toBeUndefined();
    expect(panel.logs.open).toBeTypeOf('function');
  });
});
