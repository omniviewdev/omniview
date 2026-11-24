import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextV1, SidebarContextV1, SidebarNodeV1 } from '../contract/v1';
import { acme, answering, startedOn, widgetPage, WIDGETS } from '../testing';
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

// The host of contributed pages, against an invented plugin (Acme, widgets). What is under test is what the host does with a contribution: opens its pages as tabs through the tab model,
// draws its frame, runs its hooks, contains what they throw, and words what it cannot draw. The shell, the tab model and the list page are tested in their own directories.

const ready = (contribution = acme(), id = 'acme'): PluginEntry => ({ id, name: 'Acme plugin', phase: 'ready', contribution });
const loading = (id = 'a-slow', name = 'Slow plugin'): PluginEntry => ({ id, name, phase: 'loading' });
const failed = (kind: 'missing' | 'incompatible', id = 'broken'): PluginEntry => ({
  id,
  name: 'Broken plugin',
  phase: 'failed',
  failure: { kind, message: kind === 'missing' ? 'The plugin\'s interface could not be read.' : 'This plugin was built for another version of the app. Update it.', detail: 'SECRET detail for the log' },
});

const link = (plugin: string, page?: string, connection?: string): HostRoute => ({ plugin, page, connection, params: {} });
const nav = (nodes: readonly SidebarNodeV1[]) => ({ label: 'Acme navigation', title: 'Acme', nodes });

/** The plugins the host reads: the entries now, and `set` to change them, which tells the host as the plugin store does. */
function mount(initial: readonly PluginEntry[] = [ready()], over: Partial<PluginHostProps> = {}) {
  let entries = initial;
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
  const onRetry = vi.fn<(id: string) => void>();
  const onRetryInventory = vi.fn<() => void>();
  // A window that was opened on a link has no session of its own to start from: the link opens its first tab. Any other starts from a session with one tab (`startedOn`), and `session: undefined`
  // is the window with none, which is the empty window.
  const props: PluginHostProps = { plugins, inventory: 'ready', link: NO_ROUTE, onRetry, onRetryInventory, session: over.link === undefined ? startedOn(initial) : undefined, ...over };
  const view = render(<PluginHost {...props} />);
  return {
    ...view,
    onRetry,
    onRetryInventory,
    user: userEvent.setup(),
    set: (next: readonly PluginEntry[]) => {
      act(() => {
        entries = next;
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
    again: (next: Partial<PluginHostProps>) => {
      view.rerender(<PluginHost {...props} {...next} />);
    },
  };
}

const tabs = () => screen.queryAllByRole('tab');
const faces = () => tabs().map((tab) => tab.textContent);
const selectedTab = () => tabs().find((tab) => tab.getAttribute('aria-selected') === 'true');
const entry = (name: string) => screen.getByRole('treeitem', { name });
const crumbs = () => within(screen.getByRole('navigation', { name: 'Current resource' })).queryAllByRole('listitem').map((crumb) => crumb.textContent);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('a ready plugin', () => {
  it('draws the page of the tab on screen: the frame, the sidebar with the page current, and the list', () => {
    mount();

    expect(faces()).toEqual(['Widgets']);
    expect(selectedTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Acme workspace' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('opens the page a link names, with the connection in its scope lane and in the tab\'s scope', () => {
    mount([ready()], { link: link('acme', 'gadgets', 'north') });

    expect(faces()).toHaveLength(1);
    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();
    expect(screen.getByText('gizmo')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Acme scope' })).getByText('north')).toBeInTheDocument();
    expect(selectedTab()).toHaveAccessibleName(/Gadgets.*north/);
  });

  it('falls back to the plugin\'s home for a page it does not have', () => {
    mount([ready()], { link: link('acme', 'nothing') });

    expect(faces()).toEqual(['Widgets']);
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
  });

  it('opens the plugin\'s home for a link that names only the plugin, and opens the next distinct link through smart open: in the tab on screen, the same plugin and scope', () => {
    const { again } = mount([ready()], { link: link('acme') });
    expect(faces()).toEqual(['Widgets']);

    again({ link: link('acme', 'gadgets') });
    expect(faces()).toEqual(['Gadgets']);
    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();

    again({ link: link('acme', 'gadgets', 'north') });
    expect(faces()).toHaveLength(2);
    expect(selectedTab()).toHaveAccessibleName(/Gadgets.*north/);
  });

  it('opens a link once however often the plugins change', () => {
    const { set } = mount([ready()], { link: link('acme', 'gadgets') });

    set([ready(acme())]);
    set([ready(acme(), 'acme'), ready(acme(), 'other')]);

    expect(faces()).toEqual(['Gadgets']);
  });

  it('opens nothing for a link to a plugin the host does not have: the window stays as it is, and opens no page of its own', () => {
    mount([failed('missing', 'a-broken'), ready(acme(), 'b-acme')], { link: link('nobody') });

    expect(tabs()).toHaveLength(0);
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('opens no page by itself with no link and no session, whichever plugins are ready: the window is empty (decision A17)', () => {
    mount([failed('missing', 'a-broken'), ready(acme(), 'b-acme')], { session: undefined });

    expect(tabs()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('stays loading until every plugin has settled, and is then the empty window: a plugin that loaded faster does not flash by', () => {
    const { set } = mount([loading(), ready(acme(), 'b-acme')], { session: undefined });

    expect(screen.getByRole('status', { name: 'Loading Slow plugin' })).toBeInTheDocument();
    expect(tabs()).toHaveLength(0);
    expect(screen.queryByText('alpha')).toBeNull();

    set([{ ...failed('missing', 'a-slow') }, ready(acme(), 'b-acme')]);
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
    expect(tabs()).toHaveLength(0);
  });

  it('shows a plugin a link names as soon as it is ready, whatever the others are doing', () => {
    mount([loading(), ready(acme(), 'b-acme')], { link: link('b-acme') });

    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('waits for the plugin a link names while the list of plugins is on its way, then opens the link alone', () => {
    const { set } = mount([ready(acme(), 'a-first')], { inventory: 'loading', link: link('late', 'gadgets') });

    expect(tabs()).toHaveLength(0);
    expect(screen.queryByText('alpha')).toBeNull();

    set([ready(acme(), 'a-first'), ready(acme(), 'late')]);
    expect(faces()).toEqual(['Gadgets']);
    expect(screen.getByText('gizmo')).toBeInTheDocument();
  });

  it('ends as the empty window when the link is cleared while it waited for a plugin that never came', () => {
    const { again } = mount([ready()], { inventory: 'loading', link: link('late', 'gadgets') });
    expect(tabs()).toHaveLength(0);
    expect(screen.queryByText('No tabs are open.')).toBeNull();

    again({ inventory: 'ready', link: NO_ROUTE });

    expect(tabs()).toHaveLength(0);
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
  });

  it('opens a link whose plugin reaches the store after the commit the inventory arrives in: the screen hands the plugins over in an effect of its own, which runs after the host\'s', () => {
    let entries: readonly PluginEntry[] = [];
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
    function Screen({ inventory }: { readonly inventory: PluginHostProps['inventory'] }) {
      useEffect(() => {
        if (inventory === 'ready') {
          entries = [ready()];
          for (const listener of [...listeners]) {
            listener();
          }
        }
      }, [inventory]);

      return <PluginHost plugins={plugins} inventory={inventory} link={link('acme', 'gadgets')} onRetry={vi.fn()} onRetryInventory={vi.fn()} />;
    }

    const view = render(<Screen inventory="loading" />);
    expect(tabs()).toHaveLength(0);

    view.rerender(<Screen inventory="ready" />);

    expect(faces()).toEqual(['Gadgets']);
    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();
  });

  it('gives the page\'s hook the plugin\'s id, the route it is shown for and the handle to the panel', () => {
    const seen: ContextV1[] = [];
    const contribution = acme({
      pages: {
        widgets: widgetPage('Widgets', (context) => {
          seen.push(context);
          return answering(WIDGETS)(context);
        }),
      },
      sidebar: nav([{ id: 'widgets', label: 'Widgets', icon: 'box' }]),
    });

    mount([ready(contribution, 'acme-installed')], { link: link('acme-installed', undefined, 'north') });

    expect(seen.at(-1)).toMatchObject({ plugin: 'acme-installed', route: { page: 'widgets', connection: 'north', params: {} } });
    // The handle is the plugin's own, in the connection the page is read in (`panelHost.ts`): one object for the plugin and the connection, whatever the page or the render (a hook may list it among its dependencies).
    expect(seen.at(-1)?.panel?.logs.open).toBeTypeOf('function');
    expect(new Set(seen.map((context) => context.panel)).size).toBe(1);
  });

  it('tells a list page\'s hook no parameters, whatever the address adds: they are the identity of an object, and a list has none', () => {
    const seen: ContextV1[] = [];
    const contribution = acme({
      pages: {
        widgets: widgetPage('Widgets', (context) => {
          seen.push(context);
          return answering(WIDGETS)(context);
        }),
      },
      sidebar: nav([{ id: 'widgets', label: 'Widgets', icon: 'box' }]),
    });

    mount([ready(contribution)], { link: { ...link('acme', 'widgets', 'north'), params: { name: 'alpha' } } });

    expect(seen.at(-1)?.route).toEqual({ page: 'widgets', connection: 'north', params: {} });
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
      sidebar: nav([{ id: 'widgets', label: 'Widgets', icon: 'box' }]),
    });

    mount([ready(contribution)]);

    expect(await screen.findByText('renders 1')).toBeInTheDocument();
  });
});

describe('the sidebar opens pages through the tab model', () => {
  it('navigates the tab on screen in place for a plain click: the same plugin and scope, so no tab is made', async () => {
    const { user } = mount();

    await user.click(entry('Gadgets'));

    expect(faces()).toEqual(['Gadgets']);
    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();
    expect(screen.getByText('gizmo')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('keeps the connection of the tab it is opened from', async () => {
    const { user } = mount([ready()], { link: link('acme', undefined, 'north') });

    await user.click(entry('Gadgets'));

    expect(within(screen.getByRole('group', { name: 'Acme scope' })).getByText('north')).toBeInTheDocument();
  });

  it('shows the tab that already holds the page of the entry, and makes no new one', async () => {
    const { user } = mount();
    fireEvent.click(entry('Gadgets'), { ctrlKey: true });
    expect(faces()).toEqual(['Widgets', 'Gadgets']);
    expect(selectedTab()).toHaveTextContent('Widgets');

    await user.click(entry('Gadgets'));

    expect(faces()).toEqual(['Widgets', 'Gadgets']);
    expect(selectedTab()).toHaveTextContent('Gadgets');
    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();
  });

  it('opens a background tab for a Control click, and leaves the page on screen where it is', () => {
    mount();

    fireEvent.click(entry('Gadgets'), { ctrlKey: true });

    expect(faces()).toEqual(['Widgets', 'Gadgets']);
    expect(selectedTab()).toHaveTextContent('Widgets');
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
  });

  it('opens a background tab for a Command click on a Mac', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    mount();

    fireEvent.click(entry('Gadgets'), { metaKey: true });

    expect(faces()).toEqual(['Widgets', 'Gadgets']);
    expect(selectedTab()).toHaveTextContent('Widgets');
  });

  it('opens a second tab at the plugin\'s home from the new-tab control, and shows it', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'New tab' }));

    expect(tabs()).toHaveLength(2);
    expect(faces().every((face) => face?.startsWith('Widgets'))).toBe(true);
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('follows the tab on screen in the status bar\'s path, and in the sidebar\'s current entry', async () => {
    const { user } = mount();
    expect(crumbs()).toEqual(['Acme', 'Widgets']);
    fireEvent.click(entry('Gadgets'), { ctrlKey: true });
    expect(crumbs()).toEqual(['Acme', 'Widgets']);

    await user.click(tabs()[1]);

    expect(crumbs()).toEqual(['Acme', 'Gadgets']);
    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();
    expect(crumbs().at(-1)).toBe('Gadgets');
  });

  it('has no New tab control until there is a tab to open it from', () => {
    mount([loading()]);

    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull();
  });
});

type CounterState = { instances: number; ticks: number; bump?: () => void };

describe('pages stay alive behind the strip', () => {
  /** A Widgets page whose hook has state of its own, and counts how often the host drew it from scratch. */
  const counting = (state: CounterState) =>
    acme({
      pages: {
        widgets: widgetPage('Widgets', (context) => {
          const [instance] = useState(() => {
            state.instances += 1;
            return state.instances;
          });
          const [count, setCount] = useState(0);
          state.bump = () => {
            setCount((value) => value + 1);
          };

          useEffect(() => {
            const timer = setInterval(() => {
              state.ticks += 1;
            }, 100);
            return () => {
              clearInterval(timer);
            };
          }, []);
          return answering([{ key: 'n', name: `instance ${String(instance)} count ${String(count)}` }])(context);
        }),
        gadgets: widgetPage('Gadgets', answering([{ key: 'g', name: 'gizmo' }], 'Gadgets')),
      },
    });

  it('keeps a hidden page\'s hook state across a tab switch', async () => {
    const state: CounterState = { instances: 0, ticks: 0 };
    const { user } = mount([ready(counting(state))]);
    act(() => {
      state.bump?.();
    });
    expect(screen.getByText('instance 1 count 1')).toBeInTheDocument();

    fireEvent.click(entry('Gadgets'), { ctrlKey: true });
    await user.click(tabs()[1]);
    expect(screen.getByText('instance 1 count 1')).not.toBeVisible();
    await user.click(tabs()[0]);

    expect(screen.getByText('instance 1 count 1')).toBeVisible();
    expect(state.instances).toBe(1);
  });

  it('stops a hidden page\'s interval, and starts it again when the page is shown', () => {
    vi.useFakeTimers();
    const state: CounterState = { instances: 0, ticks: 0 };
    mount([ready(counting(state))]);
    fireEvent.click(entry('Gadgets'), { ctrlKey: true });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(state.ticks).toBe(3);

    fireEvent.click(tabs()[1]);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(state.ticks).toBe(3);

    fireEvent.click(tabs()[0]);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(state.ticks).toBe(5);
  });

  it('evicts the page shown longest ago once six tabs are open: its state is lost when it is shown again', async () => {
    const state: CounterState = { instances: 0, ticks: 0 };
    const { user } = mount([ready(counting(state))]);
    act(() => {
      state.bump?.();
    });
    expect(screen.getByText('instance 1 count 1')).toBeInTheDocument();

    for (let index = 0; index < 5; index += 1) {
      await user.click(screen.getByRole('button', { name: 'New tab' }));
    }

    expect(tabs()).toHaveLength(6);
    expect(state.instances).toBe(6);
    await user.click(tabs()[0]);

    expect(screen.queryByText('instance 1 count 1')).toBeNull();
    expect(screen.getByText('instance 7 count 0')).toBeInTheDocument();
  });
});

describe('the sidebar\'s hook', () => {
  const skeleton: readonly SidebarNodeV1[] = [{ id: 'widgets', label: 'Widgets', icon: 'box' }];
  const counted: readonly SidebarNodeV1[] = [{ id: 'widgets', label: 'Widgets', icon: 'box', count: 2 }];
  const withHook = (use: (context: ContextV1) => readonly SidebarNodeV1[] | undefined) => acme({ sidebar: { ...nav(skeleton), useNodes: use } });

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

    mount([ready(contribution)]);
    expect(entry('Widgets')).toBeInTheDocument();

    expect(await screen.findByRole('treeitem', { name: 'Widgets 2' })).toBeInTheDocument();
  });

  it('draws no entry that opens no page of the contribution', () => {
    mount([ready(withHook(() => [...counted, { id: 'ghost', label: 'Ghost', icon: 'box' }]))]);

    expect(screen.getByRole('treeitem', { name: 'Widgets 2' })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'Ghost' })).toBeNull();
  });

  it('keeps the skeleton and the page when the hook throws: the sidebar is its own contribution', () => {
    mount([ready(withHook(() => {
      throw new Error('the sidebar hook is broken');
    }))]);

    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith('[plugins] acme sidebar failed to render', expect.any(Error), expect.any(String));
  });

  it('runs for the plugin on screen: another plugin\'s tab does not run this one\'s hook', async () => {
    const hook = vi.fn((): readonly SidebarNodeV1[] | undefined => undefined);
    const { user } = mount([ready(withHook(hook), 'a-acme'), ready(acme(), 'b-acme')], { link: link('b-acme') });
    expect(hook).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('the sidebar hook is told which groups are open, and what an entry may count', () => {
  const base = acme().sidebar;
  /** The hook of a sidebar that records what the host tells it: every context it was called with, in order. */
  const recording = (answer: (context: SidebarContextV1) => readonly SidebarNodeV1[] | undefined = () => undefined) => {
    const seen: SidebarContextV1[] = [];
    const use = (context: SidebarContextV1) => {
      seen.push(context);
      return answer(context);
    };

    return { seen, contribution: acme({ sidebar: { ...base, useNodes: use } }) };
  };

  const group = (children: readonly SidebarNodeV1[]): readonly SidebarNodeV1[] => [{ id: 'group', label: 'Group', icon: 'layers', children }];

  it('tells it the groups that are open on screen: the group of the page on screen is open when the tree mounts', () => {
    const { seen, contribution } = recording();
    mount([ready(contribution)]);

    expect(seen.at(-1)?.open).toEqual(['group']);
    expect(seen.at(-1)).toMatchObject({ plugin: 'acme', route: { page: 'widgets' } });
  });

  it('tells it again when the user closes the group, and when the user opens it', async () => {
    const { seen, contribution } = recording();
    const { user } = mount([ready(contribution)]);

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    expect(seen.at(-1)?.open).toEqual([]);

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    expect(seen.at(-1)?.open).toEqual(['group']);
  });

  it('gives it the same context, and the same list of groups, for as long as nothing it was told has changed: a render of the host is not a change', async () => {
    const { seen, contribution } = recording();
    const { again, user } = mount([ready(contribution)]);
    const settled = seen.at(-1);
    const calls = seen.length;

    again({});
    again({});

    expect(seen.length).toBeGreaterThan(calls);
    expect(seen.at(-1)).toBe(settled);
    expect(seen.at(-1)?.open).toBe(settled?.open);

    // A change of the groups is a change of the context, and nothing else is.
    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    expect(seen.at(-1)).not.toBe(settled);
    expect(seen.at(-1)?.open).not.toBe(settled?.open);
    expect(seen.at(-1)).toMatchObject({ plugin: settled?.plugin, route: settled?.route });
  });

  it('tells it the groups sorted, so that the same groups opened in another order are the same list', async () => {
    // The page on screen is in group `b`, so `b` is open first; the user then opens `a`. The list is not in the order they were opened in.
    const seen: SidebarContextV1[] = [];
    const nodes: readonly SidebarNodeV1[] = [
      { id: 'a', label: 'A', icon: 'layers', children: [{ id: 'gadgets', label: 'Gadgets', icon: 'box' }] },
      { id: 'b', label: 'B', icon: 'layers', children: [{ id: 'widgets', label: 'Widgets', icon: 'box' }] },
    ];
    const useNodes = (context: SidebarContextV1): undefined => {
      seen.push(context);
      return undefined;
    };

    const { user } = mount([ready(acme({ sidebar: { ...base, nodes, useNodes } }))]);
    expect(seen.at(-1)?.open).toEqual(['b']);

    await user.click(screen.getByRole('treeitem', { name: 'A' }));
    expect(seen.at(-1)?.open).toEqual(['a', 'b']);
  });

  it('draws what the hook answers for an entry: a number, an approximate count, and a slot that has no number yet', () => {
    const { contribution } = recording(() =>
      group([
        { id: 'widgets', label: 'Widgets', icon: 'box', count: 2 },
        { id: 'gadgets', label: 'Gadgets', icon: 'box', count: { value: 1234, approximate: true } },
      ]),
    );
    mount([ready(contribution)]);

    expect(screen.getByRole('treeitem', { name: 'Widgets 2' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Gadgets about 1,234' })).toBeInTheDocument();
  });

  it('holds the slot of an entry whose count is null, and draws nothing in it', () => {
    const { contribution } = recording(() => group([{ id: 'widgets', label: 'Widgets', icon: 'box', count: null }, { id: 'gadgets', label: 'Gadgets', icon: 'box' }]));
    mount([ready(contribution)]);

    expect(screen.getByRole('treeitem', { name: 'Widgets' }).querySelector('[data-shell-part="count"]')).toBeEmptyDOMElement();
    expect(screen.getByRole('treeitem', { name: 'Gadgets' }).querySelector('[data-shell-part="count"]')).toBeNull();
  });

  it('still loads a plugin written before there were open groups and approximate counts: its hook ignores the new member and its plain numbers draw as they did', () => {
    // A hook typed for the context every hook gets, as a plugin built against the first shape of this contract writes it.
    const older = (context: ContextV1): readonly SidebarNodeV1[] | undefined => (context.plugin === 'acme' ? group([{ id: 'widgets', label: 'Widgets', icon: 'box', count: 12 }]) : undefined);
    mount([ready(acme({ sidebar: { ...base, useNodes: older } }))]);

    expect(screen.getByRole('treeitem', { name: 'Widgets 12' })).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
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

  it('is the kit\'s failure notice in the page\'s place, inside the page region, with the strip, the sidebar and none of the plugin\'s own words on screen', () => {
    mount([ready(crashing({ broken: true }))]);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Couldn\'t load Widgets');
    expect(alert).toHaveTextContent('This page failed to display.');
    expect(screen.getByRole('tabpanel')).toContainElement(alert);
    expect(screen.queryByText(/SECRET/)).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith('[plugins] acme page widgets failed to render', expect.any(Error), expect.any(String));
  });

  it('tries the page again on Retry, and shows it when the hook works this time', async () => {
    const state = { broken: true };
    const { user } = mount([ready(crashing(state))]);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    state.broken = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('is contained to its tab: the frame and the other tabs stay, and the other page draws', async () => {
    const { user } = mount([ready(crashing({ broken: true }))]);
    fireEvent.click(entry('Gadgets'), { ctrlKey: true });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(tabs()[1]);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('gizmo')).toBeInTheDocument();
    expect(faces()).toEqual(['Widgets', 'Gadgets']);

    await user.click(tabs()[0]);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('leaves the other pages alone: navigating the tab to another page draws it', async () => {
    const { user } = mount([ready(crashing({ broken: true }))]);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(entry('Gadgets'));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('gizmo')).toBeInTheDocument();
  });

  it('is a page that failed, not a plugin: another plugin is untouched', () => {
    mount([ready(crashing({ broken: true }), 'a-first'), ready(acme(), 'b-second')], { link: link('b-second') });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });
});

describe('a plugin that is not ready', () => {
  it('shows the kit\'s loading state under the plugin\'s name, with no tab yet, while its interface loads', () => {
    mount([{ id: 'acme', name: 'Acme plugin', phase: 'loading' }], { session: undefined });

    expect(screen.getByRole('status', { name: 'Loading Acme plugin' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Acme plugin workspace' })).toBeInTheDocument();
    expect(tabs()).toHaveLength(0);
  });

  it('shows what kind of failure it was in the host\'s words, never the plugin\'s own detail, in a tab of its own with a Retry that asks to load it again', async () => {
    const { onRetry, user } = mount([failed('incompatible')]);

    expect(faces()).toEqual(['Broken plugin']);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t load Broken plugin');
    expect(screen.getByRole('alert')).toHaveTextContent('This plugin was built for another version of the app. Update it.');
    expect(screen.queryByText(/SECRET/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledWith('broken');
  });

  it('shows a plugin that failed beside one that did not: the link picks which', () => {
    mount([failed('missing', 'a-broken'), ready(acme(), 'b-acme')], { link: link('a-broken') });

    expect(screen.getByRole('alert')).toHaveTextContent('The plugin\'s interface could not be read.');
  });

  it('turns the stand-in tab of a plugin that loads later into its real page, and the tab\'s face follows', () => {
    const { set } = mount([loading('acme', 'Acme plugin')], { link: link('acme') });
    expect(faces()).toEqual(['Acme plugin']);
    expect(screen.getByRole('status', { name: 'Loading Acme plugin' })).toBeInTheDocument();

    set([ready()]);

    expect(faces()).toEqual(['Widgets']);
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(crumbs()).toEqual(['Acme', 'Widgets']);
  });

  it('opens a link to a page of a plugin that loads later as that page', () => {
    const { set } = mount([loading('acme', 'Acme plugin')], { link: link('acme', 'gadgets') });

    set([ready()]);

    expect(faces()).toEqual(['Gadgets']);
    expect(screen.getByText('gizmo')).toBeInTheDocument();
  });

  it('draws the regions of a frame that is on its way, empty, and the real ones replace them in the same sidebar element', () => {
    const { set, container } = mount([loading('acme', 'Acme plugin')], { link: link('acme') });
    const sidebar = container.querySelector('[data-shell-region="sidebar"]');
    const lane = container.querySelector('[data-shell-part="lane"]');

    expect(container.querySelector('[data-shell-part="rail"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('navigation', { name: 'Loading navigation' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('tree')).toBeNull();
    expect(lane).toHaveAttribute('aria-hidden', 'true');
    expect(lane).toBeEmptyDOMElement();

    set([ready()]);

    expect(container.querySelector('[data-shell-region="sidebar"]')).toBe(sidebar);
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('tree', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Acme scope' })).toHaveTextContent('Scope: none');
    expect(container.querySelector('[data-shell-part="lane"]')).not.toHaveAttribute('aria-hidden');
  });

  it('draws the frame of a plugin that failed with no sidebar: there is nothing to show of its own, and its rail entry is the way back to its page', () => {
    const { container } = mount([failed('missing')]);

    expect(container.querySelector('[data-shell-part="rail"]')).not.toHaveAttribute('aria-hidden');
    expect(screen.queryByRole('navigation', { name: /navigation/i })).toBeNull();
  });
});

describe('with no plugin to show', () => {
  it('says it is loading the list of plugins, with the frame\'s regions reserved', () => {
    const { container } = mount([], { inventory: 'loading' });

    expect(screen.getByRole('status', { name: 'Loading Plugins' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Loading navigation' })).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-shell-part="rail"]')).not.toBeNull();
  });

  it('says there are none when the list is empty', () => {
    mount([], { inventory: 'ready' });

    expect(screen.getByText('No Plugins')).toBeInTheDocument();
    expect(tabs()).toHaveLength(0);
  });

  it('says the list could not be read, with a Retry that asks for it again', async () => {
    const { onRetryInventory, user } = mount([], { inventory: 'failed' });

    expect(screen.getByRole('alert')).toHaveTextContent('The list of installed plugins could not be read.');
    await act(async () => user.click(screen.getByRole('button', { name: 'Retry' })));

    expect(onRetryInventory).toHaveBeenCalledTimes(1);
  });
});

// The window's rail (S2a): one entry for each plugin that contributes, in the order the plugins declare, and the sidebar is the sidebar of the plugin the rail has current.
describe('the rail', () => {
  /** A plugin with its own words, whose entry says its glyph, its name and its place (`order`, or none). */
  const plugin = (name: string, order: number | undefined) =>
    acme({
      plugin: { name },
      rail: order === undefined ? true : { icon: 'layers', label: `${name} plugin`, order },
      sidebar: { label: `${name} navigation`, title: name, nodes: acme().sidebar.nodes },
    });
  /** Two plugins whose ids sort the other way round from their declared order. */
  const two = (): readonly PluginEntry[] => [ready(plugin('Late', 20), 'a-late'), ready(plugin('First', 10), 'b-first')];
  const entries = () => within(screen.getByRole('group', { name: 'Plugins' })).getAllByRole('button').map((button) => button.getAttribute('aria-label'));

  it('has an entry for each plugin that contributes, in the declared order and not the order of their ids, named by the contribution', () => {
    mount(two());

    expect(entries()).toEqual(['First plugin', 'Late plugin']);
  });

  it('has the first plugin of the declared order current while no tab is open, with its sidebar shown', () => {
    mount(two(), { session: undefined });

    // The empty window lists the plugins too, by the same names: the rail is the group of that name.
    const rail = within(screen.getByRole('group', { name: 'Plugins' }));
    expect(rail.getByRole('button', { name: 'First plugin' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('navigation', { name: 'First navigation' })).toBeInTheDocument();
    expect(rail.getByRole('button', { name: 'Late plugin' })).not.toHaveAttribute('aria-current');
  });

  it('shows the sidebar of the entry that was chosen and closes no tab: the page and its landmarks stay the tab\'s', async () => {
    const { user } = mount(two());

    await act(async () => user.click(screen.getByRole('button', { name: 'Late plugin' })));

    expect(screen.getByRole('navigation', { name: 'Late navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'First navigation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Late plugin' })).toHaveAttribute('aria-current', 'true');
    expect(faces()).toEqual(['Widgets']);
    expect(screen.getByRole('main', { name: 'First workspace' })).toBeInTheDocument();
    // The page on screen is the other plugin's: no entry of this sidebar is selected.
    expect(screen.queryByRole('treeitem', { selected: true })).toBeNull();
  });

  it('opens a page of the chosen plugin in a tab of its own, tabs of both plugins stay open, and activating a tab makes its plugin current again', async () => {
    const { user } = mount(two());
    await act(async () => user.click(screen.getByRole('button', { name: 'Late plugin' })));
    // The plugin's tab is not on screen, so there is no page to reveal in its tree: its groups start closed.
    await act(async () => user.click(entry('Group')));
    await act(async () => user.click(entry('Gadgets')));

    expect(faces()).toEqual(['Widgets', 'Gadgets']);
    expect(screen.getByRole('main', { name: 'Late workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Late plugin' })).toHaveAttribute('aria-current', 'true');

    await act(async () => user.click(tabs()[0]));
    expect(screen.getByRole('main', { name: 'First workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'First plugin' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('navigation', { name: 'First navigation' })).toBeInTheDocument();
    expect(faces()).toEqual(['Widgets', 'Gadgets']);
  });

  it('puts a plugin with no declared place after every plugin that has one, by name, however the plugins are listed', () => {
    mount([ready(plugin('Zed', undefined), 'a-zed'), ready(plugin('Alpha', undefined), 'b-alpha'), ready(plugin('Mid', 5), 'c-mid')]);

    expect(entries()).toEqual(['Mid plugin', 'Alpha', 'Zed']);
  });

  it('lists a plugin that did not load after the ones that contribute, named for it, with the cause in its tip: the failure is found from the rail, not only from the page', () => {
    mount([failed('missing', 'a-broken'), ready(plugin('Fine', undefined), 'b-fine')]);

    expect(entries()).toEqual(['Fine', 'Broken plugin, did not load']);
    expect(within(screen.getByRole('group', { name: 'Plugins' })).getByRole('button', { name: 'Broken plugin, did not load' })).toHaveAttribute('data-ov-tip', 'Broken plugin, did not load\nThe plugin\'s interface could not be read.');
    // It has no sidebar of its own: the plugin that contributes keeps the rail's current entry and the sidebar.
    expect(screen.getByRole('button', { name: 'Fine' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('navigation', { name: 'Fine navigation' })).toBeInTheDocument();
  });

  it('is a rail of its own entry when no plugin contributes and one did not load, with no sidebar and no entry current', () => {
    const { container } = mount([failed('missing')], { session: undefined });

    expect(entries()).toEqual(['Broken plugin, did not load']);
    expect(container.querySelector('[data-shell-part="rail"]')).not.toHaveAttribute('aria-hidden');
    expect(screen.queryByRole('navigation', { name: /navigation/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Broken plugin, did not load', current: true })).toBeNull();
  });

  it('opens the page of a plugin that did not load from its rail entry, in a tab, naming what happened with a Retry: the sidebar and the current entry stay', async () => {
    const { user, onRetry } = mount([failed('missing', 'a-broken'), ready(plugin('Fine', undefined), 'b-fine')]);
    expect(faces()).toEqual(['Widgets']);

    await act(async () => user.click(within(screen.getByRole('group', { name: 'Plugins' })).getByRole('button', { name: 'Broken plugin, did not load' })));

    expect(faces()).toEqual(['Widgets', 'Broken plugin']);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t load Broken plugin');
    expect(screen.getByRole('alert')).toHaveTextContent('The plugin\'s interface could not be read.');
    await act(async () => user.click(screen.getByRole('button', { name: 'Retry' })));
    expect(onRetry).toHaveBeenCalledWith('a-broken');
  });
});

// Decision A17: closing the last tab leaves an empty window, with a way forward and a way out, and no page opens by itself.
describe('the empty window', () => {
  const closeLastTab = () => {
    act(() => {
      fireEvent.keyDown(screen.getByRole('tab'), { key: 'Delete' });
    });
  };

  const plugins = () => within(screen.getByRole('region', { name: 'Plugins you can open' }));

  it('says so, lists the plugins that can be opened, keeps the rail and its sidebar, and opens no page by itself', () => {
    const { set } = mount([ready()]);
    closeLastTab();

    expect(tabs()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
    expect(plugins().getByRole('button', { name: /Acme/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Plugins' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { selected: true })).toBeNull();

    // Whatever the plugins do next, nothing opens a page for the user.
    set([ready()]);
    set([ready(), ready(acme(), 'other')]);
    expect(tabs()).toHaveLength(0);
  });

  it('opens a plugin in a tab from the empty window, by its row, by a sidebar entry and by the new-tab control', async () => {
    const { user } = mount([ready()]);
    closeLastTab();
    await act(async () => user.click(plugins().getByRole('button', { name: /Acme/ })));
    expect(faces()).toEqual(['Widgets']);

    closeLastTab();
    await act(async () => user.click(entry('Gadgets')));
    expect(faces()).toEqual(['Gadgets']);

    closeLastTab();
    await act(async () => user.click(screen.getByRole('button', { name: 'New tab' })));
    expect(faces()).toEqual(['Widgets']);
  });

  it('closes the window with Command W on a Mac, once, and only when no tab is left', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const onCloseWindow = vi.fn();
    mount([ready()], { onCloseWindow });

    fireEvent.keyDown(document, { code: 'KeyW', metaKey: true });
    expect(tabs()).toHaveLength(0);
    expect(onCloseWindow).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { code: 'KeyW', metaKey: true });
    expect(onCloseWindow).toHaveBeenCalledTimes(1);
  });

  it('does not close the window with Control W on Windows or Linux, where a main window that hides has no way back: the empty window stays', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const onCloseWindow = vi.fn();
    mount([ready()], { onCloseWindow });

    fireEvent.keyDown(document, { code: 'KeyW', ctrlKey: true });
    fireEvent.keyDown(document, { code: 'KeyW', ctrlKey: true });

    expect(tabs()).toHaveLength(0);
    expect(onCloseWindow).not.toHaveBeenCalled();
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
  });

  it('is loading, not empty, while a plugin is still on its way', () => {
    mount([ready(), loading()], { session: undefined });

    expect(screen.queryByText('No tabs are open.')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading Slow plugin' })).toBeInTheDocument();
  });
});
