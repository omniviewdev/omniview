import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSession, SESSION_VERSION, type LoadedSession } from '../../shell/session';
import { CONTRIBUTION_EXPORT_V1 } from '../contract/admit';
import type { ContributionV1, ListPageViewV1, PanelBodyPropsV1, PanelToolV1 } from '../contract/v1';
import { widgetPage, WIDGETS, type Widget } from '../testing';
import { PluginHost, type PluginHostProps } from './PluginHost';
import { PluginStore, type PluginDescriptor } from './pluginStore';
import { NO_ROUTE } from './route';

// R2: what two plugins contribute is ordered by the plugin's place in the rail, whichever of them finishes loading first. Two plugins that finish loading at nearly the same time gave a bottom panel whose tools changed
// places from one run to the next (the seam's `checkPanel` failed in CI on it and passed on the rerun), and, before that, a command palette whose Enter opened another plugin's row about one run in three (C1c). This is the
// window as the screen builds it (`PluginHostScreen`: the inventory arrives, the plugins are handed to a real `PluginStore` in a layout effect, each load ends when its bundle does) over two invented plugins that
// contribute every kind of thing a plugin contributes, loaded in every order and with one of them 500 ms late, and what the user sees in each kind is compared with the rail's order.
//
// The two plugins' ids sort the other way round from the rail, so that the three orders there are (the rail's, the ids' and the order the loads end in) can be told apart: a list that is in the rail's order
// in every plan is in nobody else's.

const FIRST = 'zulu-first';
const SECOND = 'alpha-second';
/** What each plugin says it is: its name, and its place in the rail. */
const PLUGINS: Readonly<Record<string, { readonly name: string; readonly place: number }>> = {
  [FIRST]: { name: 'First', place: 10 },
  [SECOND]: { name: 'Second', place: 20 },
};
const DESCRIPTORS: readonly PluginDescriptor[] = [SECOND, FIRST].map((id) => ({ id, name: `${PLUGINS[id]?.name ?? id} plugin` }));

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });
// jsdom has no modal dialog: a stand-in that opens the element, as the attribute does.
const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

function StreamBody({ session }: PanelBodyPropsV1) {
  return <p>{`the body of ${session.title}`}</p>;
}

/** The commands the plugins were asked to run, by the plugin that ran them. */
const ran: string[] = [];

/** A plugin that contributes every kind of thing: a rail entry, a sidebar, two pages, a tool of the panel, providers and a command of the palette. Every plugin says the same words for its rows, so only the order tells them apart. */
function contributionOf(id: string): ContributionV1 {
  const { name, place } = PLUGINS[id] ?? { name: id, place: 99 };
  const page = (title: string) =>
    widgetPage(`${name} ${title}`, (): ListPageViewV1<Widget> => ({
      frame: { tab: { title: `${name} ${title}`, icon: 'box' }, path: [name, title], scope: [{ label: 'Scope', icon: 'server', text: `${name} scope` }] },
      source: { state: { kind: 'ready' }, rows: WIDGETS, complete: true, refreshing: false, refresh: async () => undefined },
    }));
  const tool: PanelToolV1 = { label: `${name} streams`, icon: 'server', order: 40, Body: StreamBody, newSession: { label: 'New stream', open: () => ({ title: `${name} run`, state: 'running' }) } };
  return {
    plugin: { name, accent: 'blue' },
    rail: { icon: 'layers', label: `${name} plugin`, order: place },
    sidebar: {
      label: `${name} navigation`,
      title: name,
      nodes: [{ id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'items', label: 'Items', icon: 'box' }, { id: 'things', label: 'Things', icon: 'box' }] }],
    },
    pages: { items: page('Items'), things: page('Things') },
    home: 'items',
    panel: { tools: { streams: tool } },
    palette: {
      providers: {
        hardware: {
          kind: 'match',
          section: 'Hardware',
          match: () => [
            { id: 'sprocket', label: 'Sprocket box', secondary: 'Hardware', icon: 'box', route: { page: 'things', params: {} } },
            { id: 'reset', label: 'Reset sprockets', secondary: 'Hardware', icon: 'box', command: { id: 'reset' } },
          ],
        },
      },
      commands: {
        reset: {
          run: (_arg, context) => {
            ran.push(context.plugin);
          },
        },
      },
    },
  };
}

/** How a plan ends the plugins' loads: each step ends the loads of the plugins it names, in the order given and in one tick, once the time given has passed since the step before it. */
type Step = { readonly ends: readonly string[]; readonly after?: number };
type Plan = { readonly name: string; readonly steps: readonly Step[] };

const PLANS: readonly Plan[] = [
  { name: 'the rail\'s first plugin finishes first', steps: [{ ends: [FIRST] }, { ends: [SECOND] }] },
  { name: 'the rail\'s second plugin finishes first', steps: [{ ends: [SECOND] }, { ends: [FIRST] }] },
  { name: 'both finish in one tick, the first one first', steps: [{ ends: [FIRST, SECOND] }] },
  { name: 'both finish in one tick, the second one first', steps: [{ ends: [SECOND, FIRST] }] },
  { name: 'the rail\'s first plugin is 500 ms late', steps: [{ ends: [SECOND] }, { ends: [FIRST], after: 500 }] },
  { name: 'the rail\'s second plugin is 500 ms late', steps: [{ ends: [FIRST] }, { ends: [SECOND], after: 500 }] },
];

/** What the screen does with the inventory: the plugins are handed to the store in a layout effect, in the commit the list arrives in, after the host's own effects (`PluginHostScreen`). */
function Screen({ store, inventory, session }: { readonly store: PluginStore; readonly inventory: PluginHostProps['inventory']; readonly session: LoadedSession | undefined }) {
  useLayoutEffect(() => {
    if (inventory === 'ready') {
      for (const descriptor of DESCRIPTORS) {
        void store.load(descriptor);
      }
    }
  }, [inventory, store]);
  return <PluginHost plugins={store} inventory={inventory} link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} session={session} />;
}

/** A window saved with these tabs, the last one on screen: what a person reopens the app to. */
function savedTabs(...plugins: readonly string[]): LoadedSession {
  const tabs = plugins.map((plugin, index) => {
    const route = { plugin, contribution: 'items', params: {} };
    return { id: `saved-${String(index)}`, route, key: `${plugin}:items`, pinned: false, preview: false };
  });
  const text = JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: tabs.at(-1)?.id, tabs }, rail: null, panel: { version: 1 } });
  return openSession({ read: async () => text, write: async () => undefined, keep: async () => undefined }, text);
}

type Opened = {
  readonly store: PluginStore;
  readonly user: UserEvent;
  /** Ends the loads of the plugins a step names, as the plan says, and lets what they started settle. */
  readonly run: (step: Step) => Promise<void>;
};

/** The window as it opens, with its plugins on their way: the inventory has arrived, and every bundle is held until a step of the plan lets it through. */
async function open(session?: LoadedSession): Promise<Opened> {
  const gates = new Map(Object.keys(PLUGINS).map((id) => [id, Promise.withResolvers<unknown>()]));
  const store = new PluginStore({
    importBundle: async (id) => {
      const gate = gates.get(id);
      if (gate === undefined) {
        throw new Error(`no bundle for ${id}`);
      }

      return gate.promise;
    },
    clearBundle: () => undefined,
    log: () => undefined,
  });
  const view = render(<Screen store={store} inventory="loading" session={session} />);
  await act(async () => {
    view.rerender(<Screen store={store} inventory="ready" session={session} />);
  });
  return {
    store,
    user: userEvent.setup(),
    run: async (step) => {
      await act(async () => {
        if (step.after !== undefined) {
          await vi.advanceTimersByTimeAsync(step.after);
        }

        for (const id of step.ends) {
          gates.get(id)?.resolve({ [CONTRIBUTION_EXPORT_V1]: contributionOf(id) });
        }
      });
    },
  };
}

/** Ends every load as the plan says. The time the plan waits is the clock's: nothing here sleeps. */
async function load(app: Opened, plan: Plan): Promise<void> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  try {
    for (const step of plan.steps) {
      await app.run(step);
    }
  } finally {
    vi.useRealTimers();
  }
}

const names = (container: HTMLElement, role: string, attribute?: string): string[] =>
  within(container)
    .getAllByRole(role)
    .map((element) => (attribute === undefined ? (element.textContent ?? '') : (element.getAttribute(attribute) ?? '')));

/** The plugins' entries in the rail, as a person reads them. */
const railNames = (): string[] => names(screen.getByRole('group', { name: 'Plugins' }), 'button', 'aria-label');
/** The tools in the panel's strip, left to right. */
const toolNames = (): string[] => names(screen.getByRole('tablist', { name: 'Panel tools' }), 'tab');
/** The tabs of the strip, left to right. */
const tabNames = (): string[] => names(screen.getByRole('tablist', { name: 'Open tabs' }), 'tab');

async function openPanel(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Panel' }));
}

/** The rows the palette lists for a search, top to bottom, each as the palette marks it: `<section>|<source>|<row>` for the host's own sources (`goto|host:pages|page:<plugin>:<page>`), `<plugin>:<provider>|<row>` for a plugin's. */
async function rowsFor(user: UserEvent, query: string): Promise<string[]> {
  await user.click(screen.getByRole('button', { name: /^Search/ }));
  await user.keyboard(query);
  await waitFor(() => {
    expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(2);
  });
  return screen.getAllByRole('option').map((option) => option.getAttribute('data-palette-row') ?? '');
}

/** The sources whose rows the palette lists for a search, in the order it lists them: one entry for each run of rows of one source. */
const sectionsFor = async (user: UserEvent, query: string): Promise<string[]> =>
  (await rowsFor(user, query)).map((row) => row.split('|')[0] ?? '').filter((source, index, all) => source !== all[index - 1]);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  ran.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** What the window shows with nothing saved, once both plugins have loaded: each list a person reads that more than one plugin brings something to. */
type Seen = {
  /** The rail's entries. */
  readonly rail: readonly string[];
  /** The plugins the empty window offers to open. */
  readonly home: readonly string[];
  /** Whose sidebar is shown while no tab and no choice says otherwise. */
  readonly sidebar: string | null;
  /** The bottom panel's tools. */
  readonly tools: readonly string[];
  /** The palette's sources for a query two plugins' providers answer alike. */
  readonly sections: readonly string[];
  /** The palette's Go to rows for a page both plugins have. */
  readonly goto: readonly string[];
};

/** The order each kind of thing is listed in, whichever plugin loaded first: the rail's. */
const IN_THE_RAILS_ORDER: Seen = {
  rail: ['First plugin', 'Second plugin'],
  home: ['First plugin', 'Second plugin'],
  sidebar: 'First navigation',
  tools: ['Terminal', 'Logs', 'First streams', 'Second streams'],
  sections: [`${FIRST}:hardware`, `${SECOND}:hardware`],
  goto: [`goto|host:pages|page:${FIRST}:things`, `goto|host:pages|page:${SECOND}:things`],
};

async function seen(plan: Plan): Promise<Seen> {
  const app = await open();
  await load(app, plan);
  const rail = railNames();
  const home = names(screen.getByRole('region', { name: 'Plugins you can open' }), 'button');
  const navigation = screen.queryByRole('navigation', { name: /navigation$/ });
  await openPanel(app.user);
  const tools = toolNames();
  const sections = await sectionsFor(app.user, 'sprocket');
  await app.user.keyboard('{Escape}');
  const goto = (await rowsFor(app.user, 'things')).filter((row) => row.startsWith('goto|host:pages|page:'));
  return { rail, home, sidebar: navigation?.getAttribute('aria-label') ?? null, tools, sections, goto };
}

describe('what two plugins contribute, in every order their loads can end in', () => {
  const observed = new Map<string, Seen>();

  beforeAll(async () => {
    for (const plan of PLANS) {
      observed.set(plan.name, await seen(plan));
      cleanup();
    }
  });

  // One comparison of every plan, so a list that is wrong shows in which plans it is.
  it.each(Object.keys(IN_THE_RAILS_ORDER) as ReadonlyArray<keyof Seen>)('lists the %s in the rail\'s order in every plan', (kind) => {
    expect(Object.fromEntries(PLANS.map((plan) => [plan.name, observed.get(plan.name)?.[kind]]))).toEqual(Object.fromEntries(PLANS.map((plan) => [plan.name, IN_THE_RAILS_ORDER[kind]])));
  });
});

describe('the tabs a window was saved with', () => {
  it.each(PLANS)('keep their order and each says its own plugin\'s words once that plugin has loaded, in every plan: $name', async (plan) => {
    // Saved in an order that is neither the rail's nor the ids': the second plugin's tab, then the first's, which is on screen.
    const app = await open(savedTabs(SECOND, FIRST));
    await load(app, plan);

    expect(tabNames()).toEqual(['Second Items', 'First Items']);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('First Items');
    // The scope lane is the page on screen's, the first plugin's, whichever plugin was ready first.
    expect(within(screen.getByRole('group', { name: 'First scope' })).getByText('First scope')).toBeInTheDocument();
  });
});

describe('a command of a plugin', () => {
  it.each(PLANS)('is the one of the plugin whose row is chosen, in every plan: $name', async (plan) => {
    const app = await open();
    await load(app, plan);
    await sectionsFor(app.user, 'reset');
    const rows = screen.getAllByRole('option', { name: /Reset sprockets/ });
    const second = rows.find((row) => row.getAttribute('data-palette-row')?.startsWith(`${SECOND}:`));
    if (second === undefined) {
      throw new Error('the second plugin has no row');
    }

    await app.user.click(second);
    await waitFor(() => {
      expect(ran).toEqual([SECOND]);
    });
  });
});

describe('a plugin that finishes after the other', () => {
  it('takes its place in the panel\'s strip, not the end of it, and nothing the person is on moves: the tool, its session and its body stay', async () => {
    const app = await open();
    await app.run({ ends: [SECOND] });
    await openPanel(app.user);
    expect(toolNames()).toEqual(['Terminal', 'Logs', 'Second streams']);
    // The person is on the tool that is there, with a session of its own open.
    await app.user.click(screen.getByRole('tab', { name: 'Second streams' }));
    await app.user.click(screen.getAllByRole('button', { name: 'New stream' })[0] ?? screen.getByRole('button', { name: 'New stream' }));
    const body = await screen.findByText('the body of Second run');
    expect(screen.getByRole('tab', { name: 'Second run', selected: true })).toBeInTheDocument();

    // The plugin the rail puts first arrives: its tool is ahead of the one that was there.
    await app.run({ ends: [FIRST] });

    expect(toolNames()).toEqual(['Terminal', 'Logs', 'First streams', 'Second streams']);
    expect(screen.getByRole('tab', { name: 'Second streams', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'First streams', selected: false })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Second run', selected: true })).toBeInTheDocument();
    expect(screen.getByText('the body of Second run')).toBe(body);
  });

  it('puts its section of the palette ahead of the other plugin\'s when the rail puts it ahead, with the palette closed: a person who opens it finds the order the rail has', async () => {
    const app = await open();
    await app.run({ ends: [SECOND] });
    await app.run({ ends: [FIRST] });

    expect(await sectionsFor(app.user, 'sprocket')).toEqual([`${FIRST}:hardware`, `${SECOND}:hardware`]);
  });
});
