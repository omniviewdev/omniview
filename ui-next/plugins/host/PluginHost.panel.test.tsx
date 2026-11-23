import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore } from '../../shell';
import type { PanelBodyPropsV1, PanelToolV1 } from '../contract/v1';
import { acme } from '../testing';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// The bottom panel through the host, against an invented plugin (Acme) that brings one tool, Streams: what the host does with a tool a plugin contributes (the body in the tool's own error
// boundary, the `+` that starts a session, a plugin that fails). The panel's own parts are tested in ui-next/shell/panel; the mapping is tested in panel.test.ts.

function StreamBody({ session }: PanelBodyPropsV1) {
  return <p>{`the body of ${session.title}`}</p>;
}

const streams = (patch: Partial<PanelToolV1> = {}): PanelToolV1 => ({
  label: 'Streams',
  icon: 'server',
  order: 40,
  Body: StreamBody,
  newSession: { label: 'New stream', open: () => ({ title: 'alpha', scope: 'north', state: 'running' }) },
  ...patch,
});

function mount(tool: PanelToolV1) {
  const panel: PanelStore = createPanelStore();
  let entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme({ panel: { tools: { streams: tool } } }) }];
  const listeners = new Set<() => void>();
  const plugins = {
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const view = render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} panel={panel} />);
  return {
    ...view,
    panel,
    user: userEvent.setup(),
    /** The plugins now, as the plugin store tells the host. */
    set: (next: readonly PluginEntry[]) => {
      act(() => {
        entries = next;
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
  };
}

const toggle = () => screen.getByRole('button', { name: 'Panel' });

/** The `+` of the strip. While the tool has no session its empty state offers the same start, so there are two controls of that name, the strip's first. */
const plus = (): HTMLElement => {
  const [first] = screen.getAllByRole('button', { name: 'New stream' });
  if (first === undefined) {
    throw new Error('the tool offers no way to start a session');
  }

  return first;
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Opens the panel and puts the plugin's tool on screen: the host's own Logs tool comes first. */
async function openStreams(user: UserEvent): Promise<void> {
  await user.click(toggle());
  await user.click(screen.getByRole('tab', { name: 'Streams' }));
}

describe('a tool a plugin brings to the panel', () => {
  it('is in the strip once the plugin is ready, after the host\'s own Terminal and Logs tools, and starts a session from its `+`', async () => {
    const { user } = mount(streams());
    await user.click(toggle());
    // The host's Terminal tool is first in the strip (the mock's order, 10), then Logs (20); Terminal is the one on screen until the user chooses another.
    expect(screen.getAllByRole('tab', { name: /^(Terminal|Logs|Streams)$/ }).map((one) => one.textContent)).toEqual(['Terminal', 'Logs', 'Streams']);
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Streams' }));
    expect(screen.getByRole('tab', { name: 'Streams' })).toHaveAttribute('aria-selected', 'true');
    await user.click(plus());
    expect(screen.getByRole('tab', { name: 'alpha' })).toHaveAttribute('aria-selected', 'true');
  });

  // The body is drawn by `renderBody`, which the shell puts in the page as it is. A promise there is a component that suspends: outside the tool's error boundary, with no fallback of the
  // panel's own (CodeRabbit, PluginHost.tsx:499).
  it('draws the body of a session in the panel, in the same commit that opens the session: a plain element, not a promise of one', async () => {
    const { user } = mount(streams());
    await openStreams(user);
    await user.click(plus());
    const body = screen.getByRole('tabpanel', { name: 'alpha' });
    expect(within(body).getByText('the body of alpha')).toBeInTheDocument();
  });

  it('keeps a body that throws inside its own boundary: the host says so in the body\'s place, the tabs and the rest of the window stay, and the plugin\'s words go to the log', async () => {
    const Broken = () => {
      throw new Error('the plugin\'s own words');
    };

    const { user } = mount(streams({ Body: Broken }));
    await openStreams(user);
    await user.click(plus());
    const body = screen.getByRole('tabpanel', { name: 'alpha' });
    expect(within(body).getByText('Couldn\'t show this session')).toBeInTheDocument();
    expect(screen.queryByText('the plugin\'s own words')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'alpha' })).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('acme panel streams'), expect.any(Error), expect.anything());
  });

  it('says nothing and opens nothing when the plugin\'s `open` throws, and the next press tries again (CodeRabbit, panel.ts:121)', async () => {
    const open = vi.fn<NonNullable<PanelToolV1['newSession']>['open']>(() => {
      throw new Error('no stream');
    });
    const { user, panel } = mount(streams({ newSession: { label: 'New stream', open } }));
    await openStreams(user);
    await user.click(plus());
    await user.click(plus());
    expect(open).toHaveBeenCalledTimes(2);
    expect(Object.keys(panel.getSnapshot().sessions)).toEqual([]);
    expect(screen.queryAllByRole('tab', { name: /alpha/ })).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[panel] acme could not start a session in streams'), expect.any(Error));
  });

  it('goes with the plugin: its sessions are hidden and the ones that were running end', async () => {
    const { user, panel, set } = mount(streams());
    await openStreams(user);
    await user.click(plus());
    expect(Object.values(panel.getSnapshot().sessions).map((one) => one.state)).toEqual(['running']);
    set([]);
    expect(Object.values(panel.getSnapshot().sessions).map((one) => one.state)).toEqual(['ended']);
    expect(screen.queryByRole('tab', { name: /alpha/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Streams' })).not.toBeInTheDocument();
  });
});
