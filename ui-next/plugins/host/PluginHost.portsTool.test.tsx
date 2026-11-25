import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, restorePanel, type PanelStore, type PortsDeps } from '../../shell';
import { fakePorts, session, settle, type FakePorts } from '../../shell/panel/ports/testing';
import { acme } from '../testing';
import type { ConnectionsApi } from './connections';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// The Ports tool through the real window (docs/ui-next/status/PF1.md): it is a tool of the host, in the strip whatever the plugins are; its body is drawn only while it is on screen with the panel open, and only then does the window ask
// the host for forwards or listen to it; the connection of a forward is named by what the window knows of its connections; Open in browser is the window's own way of opening an address. The host's calls and events are the fake of
// `shell/panel/ports/testing.ts`, and the connections' are a table of promises; the shell, the panel and the tool are the real ones.

const world = vi.hoisted(() => ({ open: vi.fn<(url: string) => Promise<void>>() }));

// The window's way of opening an address is the runtime's `Browser`, which a test has no host for: the shared helper is a recorder.
vi.mock('./openExternal', () => ({ openExternal: world.open }));

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

/** The connections the window lists for its plugins: Acme has one, named Staging. */
const connections: ConnectionsApi = {
  states: async () => Promise.resolve({ acme: [{ connection: { id: 'conn-1', name: 'Staging' }, readiness: 'CONNECTED' }] }),
  start: async () => Promise.resolve({ status: 'CONNECTED' }),
  onStatus: () => () => undefined,
  onSync: () => () => undefined,
};

/** What the window is given for the tool by a test: the host's calls and events, but not the way to open an address nor the names, which are the window's own and are what some of these tests are about. */
const given = (fake: FakePorts): Partial<PortsDeps> => ({ client: fake.deps.client, events: fake.deps.events, copy: fake.deps.copy, explain: fake.deps.explain, schedule: fake.deps.schedule, reconnect: fake.deps.reconnect, wake: fake.deps.wake });

type Rig = { readonly fake: FakePorts; readonly panel: PanelStore; readonly user: UserEvent; readonly unmount: () => void };

function mount(options: { readonly panel?: PanelStore; readonly ports?: Partial<PortsDeps>; readonly fake?: FakePorts; readonly withConnections?: boolean } = {}): Rig {
  const fake = options.fake ?? fakePorts();
  const panel = options.panel ?? createPanelStore();
  const view = render(
    <PluginHost
      plugins={plugins}
      inventory="ready"
      link={NO_ROUTE}
      onRetry={() => undefined}
      onRetryInventory={() => undefined}
      panel={panel}
      ports={options.ports ?? given(fake)}
      connections={options.withConnections === false ? undefined : connections}
    />,
  );
  return { fake, panel, user: userEvent.setup(), unmount: view.unmount };
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });
const body = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-shell-part="portsBody"]');

/** Opens the panel with its toggle and puts the Ports tool on screen. */
async function showPorts(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Panel' }));
  await user.click(tab('Ports'));
}

beforeEach(() => {
  world.open.mockReset();
  world.open.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Ports tool in the window', () => {
  it('is in the strip of the panel whatever the plugins are: after the host\'s Terminal and Logs and before its Problems and Operations, by the mock\'s orders', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    expect(within(screen.getByRole('tablist', { name: 'Panel tools' })).getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Terminal', 'Logs', 'Ports', 'Problems', 'Operations']);
  });

  it('asks the host for nothing and listens to nothing until it is on screen: the window\'s idle cost of the tool is none', async () => {
    const { fake, user } = mount();
    expect(fake.listed()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    expect(fake.listed()).toBe(0);
    expect(fake.on()).toBe(0);
    await user.click(tab('Ports'));
    expect(fake.listed()).toBe(1);
    expect(fake.handlers()).toBe(5);
    await user.click(tab('Logs'));
    expect(fake.handlers()).toBe(0);
    expect(fake.off()).toBe(5);
  });

  it('lets go of the host with the window: nothing is left listening, the names of connections included', async () => {
    const fake = fakePorts();
    const { user, unmount } = mount({ fake, ports: { ...given(fake), names: fake.deps.names } });
    await showPorts(user);
    expect(fake.handlers()).toBe(5);
    expect(fake.names.listeners()).toBe(1);
    unmount();
    expect(fake.handlers()).toBe(0);
    expect(fake.names.listeners()).toBe(0);
  });

  it('draws what the host reports, as a table, with no strip of sessions', async () => {
    const { fake, user } = mount();
    await showPorts(user);
    expect(screen.getByRole('status', { name: 'Loading forwarded ports' })).toBeInTheDocument();
    await act(async () => {
      await fake.answer([session('a')]);
    });
    expect(screen.getByRole('table', { name: 'Forwarded ports' })).toBeInTheDocument();
    expect(document.querySelector('[data-shell-part="panelSessions"]')).toBeNull();
  });

  it('names the connection of a forward by what the window knows of it: the name the host\'s records give, and never the plugin\'s id for it', async () => {
    const { fake, user } = mount();
    await showPorts(user);
    await act(async () => {
      await settle();
    });
    await act(async () => {
      await fake.answer([session('a')]);
    });
    await waitFor(() => {
      expect(within(screen.getByRole('table', { name: 'Forwarded ports' })).getByText('Staging')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('conn-1');
  });

  it('says a connection it knows no name for as a dash, in a window with no connection data', async () => {
    const { fake, user } = mount({ withConnections: false });
    await showPorts(user);
    await act(async () => {
      await fake.answer([session('a')]);
    });
    const cell = document.querySelector<HTMLElement>('[data-ports-part="connection"]');
    if (cell === null) {
      throw new Error('the row has no connection');
    }

    expect(within(cell).getByRole('img', { name: /^Not reported/ })).toBeInTheDocument();
  });

  it('opens an address with the window\'s own way, which a test or a probe may replace but a window does not have to give', async () => {
    const { fake, user } = mount();
    await showPorts(user);
    await act(async () => {
      await fake.answer([session('a', { local_port: 3000, local_host: '127.0.0.1' })]);
    });
    fake.serve([session('a', { local_port: 3000, local_host: '127.0.0.1' })]);
    const row = document.querySelector<HTMLElement>('[data-ports-id="a"]');
    if (row === null) {
      throw new Error('there is no row a');
    }

    await user.click(within(row).getByRole('button', { name: 'Open in browser' }));
    expect(world.open).toHaveBeenCalledTimes(1);
    expect(world.open).toHaveBeenCalledWith('http://127.0.0.1:3000');
  });

  it('is what a window comes back to when it was left on the Ports tool: the panel opens on it, and asks the host for the list', () => {
    const restored = restorePanel({ version: 1, open: true, height: null, tool: 'ports', active: {}, sessions: [] }, { now: 1 });
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }

    const { fake } = mount({ panel: createPanelStore({ initial: restored.state }) });
    expect(body()).not.toBeNull();
    expect(fake.listed()).toBe(1);
    expect(tab('Ports')).toHaveAttribute('aria-selected', 'true');
  });

  it('loses the tool and nothing else when it cannot listen to the host: the body that throws is the tool\'s own boundary, which says so and offers to try again', async () => {
    const fake = fakePorts();
    const broken: PortsDeps['events'] = {
      On: () => {
        throw new Error('the events are not there');
      },
    };
    const { user } = mount({ ports: { ...given(fake), events: broken } });
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    await user.click(tab('Ports'));
    expect(screen.getByText('Couldn\'t show Ports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The rest of the panel is as it was: the other tools still have their tabs.
    expect(tab('Terminal')).toBeInTheDocument();
    await user.click(tab('Logs'));
    expect(screen.queryByText('Couldn\'t show Ports')).toBeNull();
  });
});
