// The real shell and the real host palette over the fixture plugin's providers, for the probe (palette-probe.mjs, section `plugins`): the window with its Search control, a tab model whose routes the plugin describes, and
// `createHostPalette`, the product's own wiring of the plugins' providers, over a plugin source this page changes. What is invented is the plugin (the fixture's: a `match` provider and three `search` providers that cost
// what they are told, plugins/fixture/src/palette.ts) and its pages (a list and a detail page that draw nothing): the shell, the palette's view and model, the tab model and the host's wiring are the product's.
// A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
//   ?plugins=1   how many plugins are installed: `fixture-a-ok` ("Seam Fixture") and, with 2, `fixture-b-dup` ("Seam Fixture Copy"), each with the fixture's providers
//   ?quick=0     what `quick` costs in milliseconds, then `slow=300` and `big=5000` (the rows `big` returns); `window.__fixturePalette` is the fixture's control, read and written by the probe
//   ?scoped=1    the tab on screen has a connection, so the palette opens narrowed to its plugin and that connection (S69)
//
// `window.__palette` is the model's store; `window.__tabs` the tab model; `window.__plugin` takes a plugin's interface out of the live set (`unload(id)`, `fail(id)`) and brings it back (`reload(id)`, a new contribution, as a
// reload of its bundle makes); `window.__commits` lists every commit of the tree (React's profiler: the probe builds this entry with the development build of React DOM for the counts); `window.__announced` lists what the
// live region was told; `window.__sources` is how many listeners the plugin source has.
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import type { ContributionV1, DetailPageV1, FrameV1, SidebarNodeV1 } from '../../plugins/contract/v1';
import { createFixturePalette } from '../../plugins/fixture/src/palette';
import { createContributions, type PluginSource } from '../../plugins/host/contributions';
import { createHostPalette } from '../../plugins/host/palette';
import type { PluginEntry } from '../../plugins/host/pluginStore';
import { Published } from '../../plugins/host/published';
import { acme } from '../../plugins/testing';
import { createTabsStore, platformOf } from '..';
import { StaticShell, STATIC_RAIL } from '../testing';

const params = new URLSearchParams(window.location.search);
const number = (name: string, fallback: number): number => Number(params.get(name) ?? fallback);

// What the fixture's providers cost, and what they did: the control the plugin reads (plugins/fixture/src/palette.ts). Quiet providers are not asked until it exists, and here it exists from the first frame.
Reflect.set(window, '__fixturePalette', {
  stats: {},
  commands: [],
  quick: { delay: number('quick', 0), size: 5 },
  slow: { delay: number('slow', 300), size: 5 },
  big: { delay: 0, size: number('big', 5000) },
});

/** A page that draws nothing: the palette's rows lead to it, and what is under test is that they open it. */
const itemPage: DetailPageV1 = {
  kind: 'detail',
  definition: { kind: 'Item', tile: { icon: 'box' }, identity: { name: 'name' }, tabs: [{ id: 'overview', label: 'Overview' }] },
  usePage: () => ({ source: { state: { kind: 'loading' }, view: undefined, refreshing: false, refresh: async () => undefined } }),
};

const contributionOf = (name: string): ContributionV1 =>
  acme({
    plugin: { name },
    pages: { ...acme().pages, item: itemPage },
    palette: createFixturePalette(name, (item) => ({ page: 'item', params: { name: item } }), { page: 'widgets', params: {} }),
  });

const WEST = { id: 'fixture-a-ok', name: 'Seam Fixture' };
const EAST = { id: 'fixture-b-dup', name: 'Seam Fixture Copy' };
const INSTALLED = [WEST, EAST].slice(0, number('plugins', 1));
const readyOf = (installed: { readonly id: string; readonly name: string }): PluginEntry => ({ id: installed.id, name: `${installed.name} plugin`, phase: 'ready', contribution: contributionOf(installed.name) });

let entries: readonly PluginEntry[] = INSTALLED.map(readyOf);
const heard = new Set<() => void>();
const plugins: PluginSource = {
  getSnapshot: () => entries,
  subscribe: (listener) => {
    heard.add(listener);
    return () => {
      heard.delete(listener);
    };
  },
};
const set = (next: readonly PluginEntry[]): void => {
  entries = next;
  for (const listener of [...heard]) {
    listener();
  }
};

const change = (id: string, make: (installed: { readonly id: string; readonly name: string }) => PluginEntry): void => {
  const installed = INSTALLED.find((candidate) => candidate.id === id);
  if (installed !== undefined) {
    set(entries.map((entry) => (entry.id === id ? make(installed) : entry)));
  }
};

Reflect.set(window, '__plugin', {
  unload: (id = WEST.id) => {
    change(id, (installed) => ({ id: installed.id, name: `${installed.name} plugin`, phase: 'loading' }));
  },
  fail: (id = WEST.id) => {
    change(id, (installed) => ({ id: installed.id, name: `${installed.name} plugin`, phase: 'failed', failure: { kind: 'broken', message: 'The plugin\'s interface could not be loaded.' } }));
  },
  reload: (id = WEST.id) => {
    change(id, readyOf);
  },
});
Reflect.set(window, '__sources', () => heard.size);

const frames = new Published<FrameV1>();
const nodes = new Published<readonly SidebarNodeV1[] | null>();
const contributions = createContributions({ plugins, frames });
const tabs = createTabsStore({ contributions });
tabs.open({ route: { plugin: WEST.id, contribution: 'widgets', params: params.get('scoped') === '1' ? { connection: 'north' } : {} } }, { how: 'new' });
Reflect.set(window, '__tabs', tabs);

const host = createHostPalette({
  tabs,
  plugins,
  contributions,
  nodes,
  panel: undefined,
  platform: platformOf(navigator),
  onCloseWindow: undefined,
  // What a plugin's command is given of the bottom panel: a handle that opens nothing, so the check can see that a command is given one.
  panelHosts: () => ({ logs: { open: () => undefined } }),
});
host.attach();
Reflect.set(window, '__palette', host.store);

const announced: string[] = [];
Reflect.set(window, '__announced', announced);
host.announcer.subscribe(() => {
  announced.push(host.announcer.getSnapshot().text);
});

// Every commit of the shell's tree. React's Profiler calls this once for each commit that rendered something under it.
const commits: Array<{ readonly phase: string; readonly actualDuration: number }> = [];
Reflect.set(window, '__commits', commits);

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <Profiler
      id="shell"
      onRender={(_id, phase, actualDuration) => {
        commits.push({ phase, actualDuration });
      }}
    >
      <StaticShell registration={{ plugin: { name: WEST.name }, rail: STATIC_RAIL }} tabs={tabs} palette={host}>
        <button type="button">A control in the page</button>
      </StaticShell>
    </Profiler>
    <TooltipHost />
  </ThemeProvider>,
);
