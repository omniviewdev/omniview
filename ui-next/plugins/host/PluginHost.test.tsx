import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextV1, SidebarNodeV1 } from '../contract/v1';
import { acme, answering, widgetPage, WIDGETS } from '../testing';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE, type HostRoute } from './route';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// The host of contributed pages, against an invented plugin (Acme, widgets). What is under test is what the host does with a contribution: draws its
// frame, runs its hooks, contains what they throw, and words what it cannot draw. The shell and the list page are tested in their own directories.

const ready = (contribution = acme(), id = 'acme'): PluginEntry => ({ id, name: 'Acme plugin', phase: 'ready', contribution });
const failed = (kind: 'missing' | 'incompatible', id = 'broken'): PluginEntry => ({
  id,
  name: 'Broken plugin',
  phase: 'failed',
  failure: { kind, message: kind === 'missing' ? 'The plugin\'s interface could not be read.' : 'This plugin was built for another version of the app. Update it.', detail: 'SECRET detail for the log' },
});

type Overrides = Partial<PluginHostProps>;

function mount(over: Overrides = {}) {
  const onNavigate = vi.fn<(route: HostRoute) => void>();
  const onRetry = vi.fn<(id: string) => void>();
  const onRetryInventory = vi.fn<() => void>();
  const props: PluginHostProps = { entries: [ready()], inventory: 'ready', route: NO_ROUTE, onNavigate, onRetry, onRetryInventory, ...over };
  const view = render(<PluginHost {...props} />);
  return { ...view, onNavigate, onRetry, onRetryInventory, again: (next: Overrides) => {
    view.rerender(<PluginHost {...props} {...next} />); 
  } };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a ready plugin', () => {
  it('opens the plugin\'s home page with no route: the frame, the sidebar with the page current, and the list', () => {
    mount();

    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Acme workspace' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Widgets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('opens the page the route names, with the connection in its scope lane, and falls back to home for a page it does not have', () => {
    const { again } = mount({ route: { plugin: 'acme', page: 'gadgets', connection: 'north' } });

    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();
    expect(screen.getByText('gizmo')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Acme scope' })).getByText('north')).toBeInTheDocument();

    again({ route: { plugin: 'acme', page: 'nothing', connection: undefined } });
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
  });

  it('opens the first plugin that is ready when the route names none, or one the host does not know', () => {
    mount({ entries: [failed('missing', 'a-broken'), ready(acme(), 'b-acme')], route: { plugin: 'nobody', page: undefined, connection: undefined } });

    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
  });

  it('chooses a default only when every plugin has settled: a plugin that loaded faster does not flash by', () => {
    mount({ entries: [{ id: 'a-slow', name: 'Slow plugin', phase: 'loading' }, ready(acme(), 'b-acme')] });

    expect(screen.getByRole('status', { name: 'Loading Slow plugin' })).toBeInTheDocument();
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('shows a plugin the route names as soon as it is ready, whatever the others are doing', () => {
    mount({ entries: [{ id: 'a-slow', name: 'Slow plugin', phase: 'loading' }, ready(acme(), 'b-acme')], route: { plugin: 'b-acme', page: undefined, connection: undefined } });

    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('tells the host which page an entry opens, keeping the connection', async () => {
    const { onNavigate } = mount({ route: { plugin: 'acme', page: undefined, connection: 'north' } });

    await userEvent.click(screen.getByRole('treeitem', { name: 'Gadgets' }));

    expect(onNavigate).toHaveBeenCalledWith({ plugin: 'acme', page: 'gadgets', connection: 'north' });
  });

  it('gives the page\'s hook the plugin\'s id and the route it is shown for', () => {
    const seen: ContextV1[] = [];
    const contribution = acme({
      pages: {
        widgets: widgetPage('Widgets', (context) => {
          seen.push(context);
          return answering(WIDGETS)(context);
        }),
      },
      sidebar: { label: 'Acme navigation', title: 'Acme', nodes: [{ id: 'widgets', label: 'Widgets', icon: 'box' }] },
    });

    mount({ entries: [ready(contribution, 'acme-installed')], route: { plugin: 'acme-installed', page: undefined, connection: 'north' } });

    expect(seen.at(-1)).toEqual({ plugin: 'acme-installed', route: { page: 'widgets', connection: 'north' } });
  });

  it('runs the page\'s hook in the host\'s React: a hook the plugin uses has state', async () => {
    const contribution = acme({
      pages: {
        widgets: widgetPage('Widgets', (context) => {
          const [count, setCount] = useState(0);
          useEffect(() => {
            setCount(1);
          }, []);
          return answering([{ key: 'n', name: `renders ${String(count)}` }])(context);
        }),
      },
      sidebar: { label: 'Acme navigation', title: 'Acme', nodes: [{ id: 'widgets', label: 'Widgets', icon: 'box' }] },
    });

    mount({ entries: [ready(contribution)] });

    expect(await screen.findByText('renders 1')).toBeInTheDocument();
  });
});

describe('the sidebar\'s hook', () => {
  const skeleton: readonly SidebarNodeV1[] = [{ id: 'widgets', label: 'Widgets', icon: 'box' }];
  const counted: readonly SidebarNodeV1[] = [{ id: 'widgets', label: 'Widgets', icon: 'box', count: 2 }];
  const withHook = (use: (context: ContextV1) => readonly SidebarNodeV1[] | undefined) =>
    acme({ sidebar: { label: 'Acme navigation', title: 'Acme', nodes: skeleton, useNodes: use } });

  it('leaves the skeleton while it answers nothing, and replaces it when it answers entries', async () => {
    const contribution = withHook(() => {
      const [nodes, setNodes] = useState<readonly SidebarNodeV1[] | undefined>(undefined);
      useEffect(() => {
        const timer = setTimeout(() => {
          setNodes(counted);
        }, 20);
        return () => {
          clearTimeout(timer);
        };
      }, []);
      return nodes;
    });

    mount({ entries: [ready(contribution)] });
    expect(screen.getByRole('treeitem', { name: 'Widgets' })).toBeInTheDocument();

    expect(await screen.findByRole('treeitem', { name: 'Widgets 2' })).toBeInTheDocument();
  });

  it('draws no entry that opens no page of the contribution', () => {
    const contribution = withHook(() => [...counted, { id: 'ghost', label: 'Ghost', icon: 'box' }]);

    mount({ entries: [ready(contribution)] });

    expect(screen.getByRole('treeitem', { name: 'Widgets 2' })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'Ghost' })).toBeNull();
  });

  it('keeps the skeleton and the page when the hook throws: the sidebar is its own contribution', () => {
    const contribution = withHook(() => {
      throw new Error('the sidebar hook is broken');
    });

    mount({ entries: [ready(contribution)] });

    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith('[plugins] acme sidebar failed to render', expect.any(Error), expect.any(String));
  });
});

describe('a page that fails', () => {
  /** A plugin whose Widgets page throws from its data hook for as long as `state.broken` is set. React renders a failing tree twice before it gives up, so a count would be spent by the retry. */
  const crashing = (state: { broken: boolean }) =>
    acme({
      pages: {
        widgets: widgetPage('Widgets', (context) => {
          if (state.broken) {
            throw new Error('SECRET internals of the plugin');
          }

          return answering(WIDGETS)(context);
        }),
        gadgets: widgetPage('Gadgets', answering([{ key: 'g', name: 'gizmo' }], 'Gadgets')),
      },
    });

  it('is the kit\'s failure notice in the page\'s place, with the sidebar still there and none of the plugin\'s own words on screen', () => {
    mount({ entries: [ready(crashing({ broken: true }))] });

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t load Widgets');
    expect(screen.getByRole('alert')).toHaveTextContent('This page failed to display.');
    expect(screen.queryByText(/SECRET/)).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith('[plugins] acme page widgets failed to render', expect.any(Error), expect.any(String));
  });

  it('tries the page again on Retry, and shows it when the hook works this time', async () => {
    const state = { broken: true };
    mount({ entries: [ready(crashing(state))] });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    state.broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('leaves the other pages alone: another page of the plugin draws', () => {
    const { again } = mount({ entries: [ready(crashing({ broken: true }))] });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    again({ entries: [ready(crashing({ broken: true }))], route: { plugin: 'acme', page: 'gadgets', connection: undefined } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('gizmo')).toBeInTheDocument();
  });

  it('is a page that failed, not a plugin: another plugin is untouched', () => {
    mount({ entries: [ready(crashing({ broken: true }), 'a-first'), ready(acme(), 'b-second')], route: { plugin: 'b-second', page: undefined, connection: undefined } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });
});

describe('a plugin that is not ready', () => {
  it('shows the kit\'s loading state under the plugin\'s name while its interface loads', () => {
    mount({ entries: [{ id: 'acme', name: 'Acme plugin', phase: 'loading' }] });

    expect(screen.getByRole('status', { name: 'Loading Acme plugin' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Acme plugin workspace' })).toBeInTheDocument();
  });

  it('shows what kind of failure it was in the host\'s words, never the plugin\'s own detail, with a Retry that asks to load it again', async () => {
    const { onRetry } = mount({ entries: [failed('incompatible')] });

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t load Broken plugin');
    expect(screen.getByRole('alert')).toHaveTextContent('This plugin was built for another version of the app. Update it.');
    expect(screen.queryByText(/SECRET/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledWith('broken');
  });

  it('shows a plugin that failed beside one that did not: the route picks which', () => {
    mount({ entries: [failed('missing', 'a-broken'), ready(acme(), 'b-acme')], route: { plugin: 'a-broken', page: undefined, connection: undefined } });

    expect(screen.getByRole('alert')).toHaveTextContent('The plugin\'s interface could not be read.');
  });
});

describe('with no plugin to show', () => {
  it('says it is loading the list of plugins', () => {
    mount({ entries: [], inventory: 'loading' });

    expect(screen.getByRole('status', { name: 'Loading Plugins' })).toBeInTheDocument();
  });

  it('says there are none when the list is empty', () => {
    mount({ entries: [], inventory: 'ready' });

    expect(screen.getByText('No Plugins')).toBeInTheDocument();
  });

  it('says the list could not be read, with a Retry that asks for it again', async () => {
    const { onRetryInventory } = mount({ entries: [], inventory: 'failed' });

    expect(screen.getByRole('alert')).toHaveTextContent('The list of installed plugins could not be read.');
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Retry' })));

    expect(onRetryInventory).toHaveBeenCalledTimes(1);
  });
});
