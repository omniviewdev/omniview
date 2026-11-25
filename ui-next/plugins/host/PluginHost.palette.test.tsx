import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore } from '../../shell';
import type { ContextV1, PaletteCommandV1, PaletteProviderV1, PaletteRowV1, PaletteV1, SidebarNodeV1 } from '../contract/v1';
import { acme, answering, startedOn, widgetPage } from '../testing';
import * as palette from './palette';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import type { PortForwardNetwork } from './portForward';
import { NO_ROUTE } from './route';

// The window's command palette through the host (palette.ts is tested on its own): that PluginHost makes it of the window's own models, attaches it for as long as the window is on screen, and
// lets go of it when the window goes. What the shell draws of it is the shell's, and is tested there.

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

type Made = { readonly deps: palette.HostPaletteDeps; readonly palette: palette.HostPalette };

/** The palettes the host makes, with what it made them of, and how many are attached now. */
function watch() {
  const create = palette.createHostPalette;
  const made: Made[] = [];
  const live = { attached: 0 };
  vi.spyOn(palette, 'createHostPalette').mockImplementation((deps) => {
    const real = create(deps);
    const watched: palette.HostPalette = {
      ...real,
      attach: () => {
        live.attached += 1;
        const stop = real.attach();
        return () => {
          live.attached -= 1;
          stop();
        };
      },
    };
    made.push({ deps, palette: watched });
    return watched;
  });
  return { made, live };
}

function mount(over: { readonly onCloseWindow?: () => void; readonly panel?: PanelStore } = {}, options: { readonly reactStrictMode?: boolean } = {}) {
  return render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} {...over} />, options);
}

// jsdom has no modal dialog: a stand-in that opens the element, as the attribute does (what a modal does in a real engine is the shell's probes').
const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the host\'s palette', () => {
  it('is made once, of the window\'s own models: its plugins, its panel, the callback that closes the window, and the tab model the shell draws', () => {
    const { made } = watch();
    const panel = createPanelStore();
    const onCloseWindow = vi.fn();
    mount({ onCloseWindow, panel });

    expect(made).toHaveLength(1);
    const deps = made[0]?.deps;
    expect(deps?.plugins).toBe(plugins);
    expect(deps?.panel).toBe(panel);
    expect(deps?.onCloseWindow).toBe(onCloseWindow);
    expect(deps?.contributions.home?.('acme')).toEqual({ plugin: 'acme', contribution: 'widgets' });
    // The tab the palette's tab model opens is the one the shell draws.
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    act(() => {
      deps?.tabs.open({ route: { plugin: 'acme', contribution: 'widgets' } });
    });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('is told the platform the window runs on', () => {
    const { made } = watch();
    mount();
    expect(made[0]?.deps.platform).toBe('other');
    cleanup();

    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    mount();
    expect(made[1]?.deps.platform).toBe('mac');
  });

  it('is attached while the window is on screen, and let go of when it leaves', () => {
    const { made, live } = watch();
    const view = mount();
    expect(live.attached).toBe(1);

    // Attached to the models the window drives: the place a tab opens at is remembered.
    act(() => {
      made[0]?.deps.tabs.open({ route: { plugin: 'acme', contribution: 'widgets' } });
    });
    expect(made[0]?.palette.store.getSnapshot().recents.map((recent) => recent.route.contribution)).toEqual(['widgets']);

    view.unmount();
    expect(live.attached).toBe(0);
  });

  it('is attached once at a time when the window mounts twice, as React does while it is developed', () => {
    const { live } = watch();
    const view = mount({}, { reactStrictMode: true });
    expect(live.attached).toBe(1);

    view.unmount();
    expect(live.attached).toBe(0);
  });

  it('is the one the shell draws: the top row has its Search control, and it opens the palette', async () => {
    const { made } = watch();
    const user = userEvent.setup();
    mount();
    expect(made[0]?.palette.store.getSnapshot().open).toBe(false);

    await user.click(screen.getByRole('button', { name: /^Search/ }));

    expect(made[0]?.palette.store.getSnapshot().open).toBe(true);
  });
});

// What the plugins bring to the palette (C1c), through the real window: PluginHost over a plugin source the test changes, as the plugin store does when a plugin loads, is loaded again or does not load. The
// palette's own parts are read in the DOM, as a person reads them. Each provider here is the plugin's own function: what the host does with it (registers it when the plugin is ready, takes it away with its
// pending request when the plugin is not, reads its rows, runs its command) is what is under test; what the model does with candidates is the model's (shell/core/palette), and the rest of the host's wiring is palette.test.ts.
describe('the providers of the plugins, through the window', () => {
  type Source = {
    readonly getSnapshot: () => readonly PluginEntry[];
    readonly subscribe: (listener: () => void) => () => void;
    readonly set: (next: readonly PluginEntry[]) => void;
  };

  /** A plugin source the test changes: the plugin store's interface, with `set` for what a load, a reload or a failure does. */
  function source(initial: readonly PluginEntry[]): Source {
    let current = initial;
    const heard = new Set<() => void>();
    return {
      getSnapshot: () => current,
      subscribe: (listener) => {
        heard.add(listener);
        return () => {
          heard.delete(listener);
        };
      },
      set: (next) => {
        current = next;
        act(() => {
          for (const listener of [...heard]) {
            listener();
          }
        });
      },
    };
  }

  const widgetsRow = (id: string, label: string, secondary = 'Hardware', page = 'gadgets'): PaletteRowV1 => ({ id, label, secondary, icon: 'box', route: { page, params: {} } });
  const matching = (rows: readonly PaletteRowV1[], section = 'Hardware'): PaletteProviderV1 => ({ kind: 'match', section, match: () => rows });
  const bringing = (id: string, name: string, palette: PaletteV1 | undefined): PluginEntry => ({ id, name: `${name} plugin`, phase: 'ready', contribution: acme({ plugin: { name }, rail: true, palette }) });
  const loading = (entry: PluginEntry): PluginEntry => ({ id: entry.id, name: entry.name, phase: 'loading' });
  const failed = (entry: PluginEntry): PluginEntry => ({ id: entry.id, name: entry.name, phase: 'failed', failure: { kind: 'broken', message: 'The plugin\'s interface could not be loaded.' } });

  function open(plugins: Source, view: Partial<Parameters<typeof PluginHost>[0]> = {}) {
    const user = userEvent.setup();
    const session = startedOn(plugins.getSnapshot());
    const rendered = render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} session={session} {...view} />);
    return { user, ...rendered };
  }

  const search = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await user.click(screen.getByRole('button', { name: /^Search/ }));
    await user.keyboard(text);
  };

  const optionNames = () => screen.queryAllByRole('option').map((option) => option.getAttribute('aria-label'));
  /** The tabs of the strip, left to right, and which is on screen. */
  const strip = () => within(screen.getByRole('tablist', { name: 'Open tabs' })).getAllByRole('tab').map((tab) => `${tab.textContent ?? ''}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`);

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('draws what a plugin that is ready brings in a section of its own, and opens a row in the tab on screen with Enter', async () => {
    const plugins = source([bringing('acme', 'Acme', { providers: { things: matching([widgetsRow('s1', 'Sprocket box')]) } })]);
    const { user } = open(plugins);
    await search(user, 'sprocket');

    await screen.findByRole('option', { name: 'Page: Sprocket box, Hardware' });
    expect(screen.getByRole('option', { name: 'Page: Sprocket box, Hardware' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('dialog', { name: 'Search' })).getByText('Acme · Hardware')).toBeInTheDocument();
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(strip()).toEqual(['Gadgets*']);
  });

  it('opens the same row on every run, whichever of two plugins that bring equal rows loaded first: their sections follow the rail, so Enter stays in the plugin the rail puts first (a race between two loads decided it)', async () => {
    const first = bringing('acme', 'Acme', { providers: { things: matching([widgetsRow('a1', 'Sprocket box')]) } });
    const second = bringing('bolt', 'Bolt', { providers: { things: matching([widgetsRow('b1', 'Sprocket box')]) } });
    // Bolt is ready first and Acme, which the rail puts before it, after it. The window starts on Acme's page, as a session left it.
    const plugins = source([loading(first), second]);
    const { user } = open(plugins, { session: startedOn([first, second]) });
    plugins.set([first, second]);
    await search(user, 'sprocket');

    await screen.findAllByRole('option', { name: 'Page: Sprocket box, Hardware' });
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('data-palette-row')?.split('|')[0])).toEqual(['acme:things', 'bolt:things']);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');

    expect(strip()).toEqual(['Gadgets*']);
  });

  it.each([
    ['Alt Enter, here', '{Alt>}{Enter}{/Alt}', ['Gadgets*']],
    ['Control Shift Enter, a new tab shown', '{Control>}{Shift>}{Enter}{/Shift}{/Control}', ['Widgets', 'Gadgets*']],
    ['Control Enter, a background tab', '{Control>}{Enter}{/Control}', ['Widgets*', 'Gadgets']],
  ])('opens a row as the host\'s own rows open: %s', async (_name, keys, wanted) => {
    const plugins = source([bringing('acme', 'Acme', { providers: { things: matching([widgetsRow('s1', 'Sprocket box')]) } })]);
    const { user } = open(plugins);
    await search(user, 'sprocket');
    await screen.findByRole('option', { name: 'Page: Sprocket box, Hardware' });

    await user.keyboard(keys);

    expect(strip()).toEqual(wanted);
  });

  it('asks a provider that answers on demand once the typing has been still, and shows its rows below the host\'s, as resources', async () => {
    const lookup = vi.fn(async (query: string) => [widgetsRow('l1', `${query} found`, 'Lookup')]);
    const plugins = source([bringing('acme', 'Acme', { providers: { lookups: { kind: 'search', section: 'Lookups', search: lookup } } })]);
    const { user } = open(plugins);
    await search(user, 'abc');

    await screen.findByRole('option', { name: 'Resource: abc found, Lookup' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('abc', expect.objectContaining({ plugin: null }), expect.any(AbortSignal));
  });

  it.each([
    ['is loaded again', loading],
    ['does not load', failed],
  ])('takes a plugin\'s section and its pending request away when the plugin %s, and the palette stays as it was for the rest', async (_name, leave) => {
    let signal: AbortSignal | undefined;
    const pending = bringing('acme', 'Acme', {
      providers: {
        things: matching([widgetsRow('s1', 'Sprocket box')]),
        lookups: { kind: 'search', section: 'Lookups', search: async (_query, _scope, given) => {
          signal = given; return new Promise<never>(() => undefined); 
        } },
      },
    });
    const other = bringing('beta', 'Beta', { providers: { things: matching([widgetsRow('b1', 'Sprocket crate', 'Storage')], 'Storage') } });
    const plugins = source([pending, other]);
    const { user } = open(plugins);
    await search(user, 'sprocket');
    await screen.findByRole('option', { name: 'Page: Sprocket box, Hardware' });
    await waitFor(() => {
      expect(signal).toBeDefined();
    });
    expect(signal?.aborted).toBe(false);

    plugins.set([leave(pending), other]);

    await waitFor(() => {
      expect(optionNames()).not.toContain('Page: Sprocket box, Hardware');
    });
    expect(signal?.aborted).toBe(true);
    expect(optionNames()).toContain('Page: Sprocket crate, Storage');
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('sprocket');
  });

  it('brings the section back when the plugin is ready again, without a keystroke', async () => {
    const west = bringing('acme', 'Acme', { providers: { things: matching([widgetsRow('s1', 'Sprocket box')]) } });
    const plugins = source([west]);
    const { user } = open(plugins);
    await search(user, 'sprocket');
    await screen.findByRole('option', { name: 'Page: Sprocket box, Hardware' });

    plugins.set([loading(west)]);
    await waitFor(() => {
      expect(optionNames()).not.toContain('Page: Sprocket box, Hardware');
    });
    plugins.set([bringing('acme', 'Acme', { providers: { things: matching([widgetsRow('s1', 'Sprocket box')]) } })]);

    await screen.findByRole('option', { name: 'Page: Sprocket box, Hardware' });
  });

  it('says in the status band which source of a plugin did not answer, with a Retry, and the plugin\'s other providers and the host\'s rows are drawn', async () => {
    let answers = 0;
    const plugins = source([
      bringing('acme', 'Acme', {
        providers: {
          lookups: {
            kind: 'search',
            section: 'Lookups',
            search: async () => {
              answers += 1;
              if (answers === 1) {
                throw new Error('secret detail');
              }

              return [widgetsRow('l1', 'lookup found', 'Lookup')];
            },
          },
          things: matching([widgetsRow('s1', 'lookup box')]),
        },
      }),
    ]);
    const { user } = open(plugins);
    await search(user, 'lookup');

    const band = await screen.findByText('Lookups: Unavailable');
    expect(optionNames()).toContain('Page: lookup box, Hardware');
    expect(document.body.textContent).not.toContain('secret detail');
    await user.click(within(band.closest('[data-palette-part="band"]')!).getByRole('button', { name: /^Retry/ }));

    await screen.findByRole('option', { name: 'Resource: lookup found, Lookup' });
    expect(answers).toBe(2);
  });

  it('runs a plugin\'s command from a row with Enter, with the argument the row carried and the panel the plugin was given', async () => {
    const run = vi.fn<PaletteCommandV1['run']>();
    const plugins = source([
      bringing('acme', 'Acme', {
        providers: { things: { kind: 'match', section: 'Hardware', filter: 'goto', match: () => [{ id: 'r1', label: 'Reset sprockets', icon: 'refresh', command: { id: 'reset', arg: { all: true } } }] } },
        commands: { reset: { run } },
      }),
    ]);
    const { user } = open(plugins);
    await search(user, 'reset sprockets');
    await screen.findByRole('option', { name: 'Command: Reset sprockets' });

    await user.keyboard('{Enter}');

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual({ all: true });
    expect(run.mock.calls[0]?.[1]).toMatchObject({ plugin: 'acme', panel: { logs: { open: expect.any(Function) } } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives a plugin\'s command a handle with no ports member, though a page of the same plugin in a connection has one: a command runs from the palette and not from a page, so a member that could only refuse is left out (PF1)', async () => {
    const run = vi.fn<PaletteCommandV1['run']>();
    const seen: ContextV1[] = [];
    const entry: PluginEntry = {
      id: 'acme',
      name: 'Acme plugin',
      phase: 'ready',
      contribution: acme({
        pages: {
          widgets: widgetPage('Widgets', (context) => {
            seen.push(context);
            return answering([])(context);
          }),
        },
        palette: {
          providers: { things: { kind: 'match', section: 'Hardware', filter: 'goto', match: () => [{ id: 'r1', label: 'Reset sprockets', icon: 'refresh', command: { id: 'reset' } }] } },
          commands: { reset: { run } },
        },
      }),
    };
    const networker: PortForwardNetwork = { start: vi.fn(async () => Promise.resolve({ id: 'forward-1', local_port: 9090 })), stop: vi.fn(async () => Promise.resolve(undefined)) };
    const { user } = open(source([entry]), { networker, link: { plugin: 'acme', page: 'widgets', connection: 'north', params: {} }, session: undefined });
    await waitFor(() => {
      expect(seen.at(-1)?.panel).toBeDefined();
    });
    // The window can forward, in the connection the page is read in.
    expect(seen.at(-1)?.panel?.ports?.forward).toBeTypeOf('function');

    await search(user, 'reset sprockets');
    await screen.findByRole('option', { name: 'Command: Reset sprockets' });
    await user.keyboard('{Enter}');

    expect(run).toHaveBeenCalledTimes(1);
    const given = run.mock.calls[0]?.[1];
    expect(given?.panel?.logs.open).toBeTypeOf('function');
    expect(given?.panel?.ports).toBeUndefined();
    expect(networker.start).not.toHaveBeenCalled();
  });

  it('still loads a plugin written before the palette, and draws the window as it always did: the palette lists the host\'s sources and no section of the plugin\'s', async () => {
    const plugins = source([{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }]);
    const { user } = open(plugins);
    await search(user, 'gadgets');

    await screen.findByRole('option', { name: /^Page: Gadgets/ });
    expect(screen.queryAllByRole('group').map((group) => group.getAttribute('aria-labelledby')).filter((id) => id !== null)).toHaveLength(1);
    expect(optionNames().filter((name) => name?.startsWith('Resource:'))).toEqual([]);
    expect(strip()).toEqual(['Widgets*']);
  });

  it('registers a plugin\'s providers once when the window mounts twice, as React does while it is developed, and takes them away when the window goes', async () => {
    const { made } = watch();
    const match = vi.fn(() => [widgetsRow('s1', 'Sprocket box')]);
    const plugins = source([bringing('acme', 'Acme', { providers: { things: { kind: 'match', section: 'Hardware', match } } })]);
    const user = userEvent.setup();
    const view = render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} session={startedOn(plugins.getSnapshot())} />, { reactStrictMode: true });
    await search(user, 'sprocket');
    await screen.findByRole('option', { name: 'Page: Sprocket box, Hardware' });
    expect(screen.getAllByText('Acme · Hardware')).toHaveLength(1);

    view.unmount();

    // Whichever of the palettes React made was the window's, none of them has the plugin's providers now.
    for (const { palette } of made) {
      act(() => {
        palette.store.open({ kind: 'goto' });
        palette.store.setQuery('sprocket');
      });
      expect(palette.store.getSnapshot().sections.map((section) => section.id).filter((id) => id.includes(':'))).toEqual([]);
    }
  });
});

// What a plugin's sidebar says of its pages (C1e), through the real window: a plugin whose entries carry keywords (the other names their pages are known by), a plugin written before them, and one whose keywords are not valid.
describe('the keywords of a plugin\'s sidebar, through the window', () => {
  const entry = (nodes: readonly SidebarNodeV1[]): PluginEntry => ({
    id: 'acme',
    name: 'Acme plugin',
    phase: 'ready',
    contribution: acme({
      sidebar: { label: 'Acme navigation', title: 'Acme', nodes },
      pages: { ...acme().pages, gazebo: widgetPage('Gazebo', answering([], 'Gazebo')) },
    }),
  });
  const group = (...children: readonly SidebarNodeV1[]): readonly SidebarNodeV1[] => [{ id: 'group', label: 'Group', icon: 'layers', children }];
  const widgets: SidebarNodeV1 = { id: 'widgets', label: 'Widgets', icon: 'box' };

  /** The window over the plugins, and `search`: the Search control pressed and the text typed, as a person does. */
  function open(plugins: readonly PluginEntry[]) {
    const user = userEvent.setup();
    const source = { getSnapshot: () => plugins, subscribe: () => () => undefined };
    render(<PluginHost plugins={source} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} session={startedOn(plugins)} />);
    return {
      user,
      search: async (text: string) => {
        await user.click(screen.getByRole('button', { name: /^Search/ }));
        await user.keyboard(text);
      },
    };
  }

  const strip = () => within(screen.getByRole('tablist', { name: 'Open tabs' })).getAllByRole('tab').map((tab) => `${tab.textContent ?? ''}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`);

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('finds a page by a keyword its entry carries, first, and Enter opens it in the tab on screen: Gazebo holds the keyword\'s letters in a word of its title and used to come first', async () => {
    const { user, search } = open([entry(group(widgets, { id: 'gadgets', label: 'Gadgets', icon: 'box', keywords: ['gz'] }, { id: 'gazebo', label: 'Gazebo', icon: 'box' }))]);
    await search('gz');

    await screen.findByRole('option', { name: 'Page: Gadgets, Group' });
    const names = screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'));
    expect(names.slice(0, 2)).toEqual(['Page: Gadgets, Group', 'Page: Gazebo, Group']);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    // Nothing of the keyword is drawn: the row is its label and its group.
    expect(screen.getByRole('option', { name: 'Page: Gadgets, Group' }).textContent).toBe('Gadgets Group');

    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(strip()).toEqual(['Gadgets*']);
  });

  it('draws a plugin written before the keywords as it always did: its pages are found by their labels, their groups and the plugin\'s name', async () => {
    const { search } = open([entry(group(widgets, { id: 'gadgets', label: 'Gadgets', icon: 'box' }, { id: 'gazebo', label: 'Gazebo', icon: 'box' }))]);
    await search('gz');

    await screen.findByRole('option', { name: 'Page: Gazebo, Group' });
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('aria-label')).filter((name) => name?.startsWith('Page:'))).toEqual(['Page: Gazebo, Group']);
  });

  it('leaves a keyword that is not valid out and tells the plugin\'s author once, whatever is typed after: the page is still there, found by its label and by the keywords that are', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { user, search } = open([entry(group(widgets, { id: 'gadgets', label: 'Gadgets', icon: 'box', keywords: ['two words', 'gd'] }))]);
    await search('gd');

    await screen.findByRole('option', { name: 'Page: Gadgets, Group' });
    await user.keyboard('{Backspace}g');
    await screen.findByRole('option', { name: 'Page: Gadgets, Group' });
    const said = warn.mock.calls.map((call) => String(call[0]));
    expect(said).toEqual(['[palette] acme:sidebar: sidebar entry "gadgets": keyword 1 is not a word of 1 to 32 characters, with no white space in it: it is left out']);
  });
});

// The connection a row says (C1f), through the real window: the host hands the palette the frames its pages published, so a page whose lane names the connection `north` makes the palette say `north` for a route that carries the key.
describe('the connection a row says, through the window', () => {
  it('says the name the page\'s lane gives, in its chips and its rows, and the key the route carries is in nothing the palette draws', async () => {
    const key = 'north-57a082bd74';
    const named = (context: ContextV1) => {
      const view = answering([], 'Gadgets')(context);
      return { ...view, frame: { ...view.frame, scope: [{ label: 'Connection', icon: 'server' as const, text: 'north' }] } };
    };

    const plugin: PluginEntry = {
      id: 'acme',
      name: 'Acme plugin',
      phase: 'ready',
      contribution: acme({
        sidebar: { label: 'Acme navigation', title: 'Acme', nodes: [{ id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'widgets', label: 'Widgets', icon: 'box' }, { id: 'gadgets', label: 'Gadgets', icon: 'box' }] }] },
        pages: { ...acme().pages, widgets: widgetPage('Widgets', named), gadgets: widgetPage('Gadgets', named) },
      }),
    };
    const user = userEvent.setup();
    const list = [plugin];
    const source = { getSnapshot: () => list, subscribe: () => () => undefined };
    render(<PluginHost plugins={source} inventory="ready" link={{ plugin: 'acme', page: 'gadgets', connection: key, params: {} }} onRetry={() => undefined} onRetryInventory={() => undefined} session={startedOn([plugin])} />);
    await within(await screen.findByRole('group', { name: 'Acme scope' })).findByText('north');

    await user.click(screen.getByRole('button', { name: /^Search/ }));
    const drawn = (): string => {
      const open = screen.getByRole('dialog');
      return [open.textContent ?? '', ...[...open.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label') ?? '')].join('\n');
    };

    expect(screen.getByRole('group', { name: 'Search scope' })).toHaveTextContent('north');
    expect(drawn()).not.toContain(key);

    // Without the chips the rows say the connection, by its name.
    await user.keyboard('{Backspace}{Backspace}gadgets');
    await screen.findByRole('option', { name: 'Page: Gadgets, north · Group' });
    expect(drawn()).not.toContain(key);
  });
});
