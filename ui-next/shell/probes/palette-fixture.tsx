// The real shell and the real palette over invented sources, for the probe (palette-probe.mjs): the window with the command palette's Search control, and a store whose providers are the probe's. The
// shell, the palette's view, the model and the tab model are the product's own; only what the providers offer is invented. NOTHING HERE IS WHAT THE HOST LISTS: the host's own sources are the ones in
// ui-next/plugins/host/palette.ts (pages, tabs, and five commands), and its palette does not say New window. The forty commands and their chords are stand-ins that give the mock's scenes their
// geometry, and `windows: true` below gives the footer the mock's five open keys for the same reason. A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
//   ?case=geometry  (default) the sources the mock's reference scenes are compared on: seven plugin homes (the first with a context, each searchable inside), eight pages (a context each, the last four
//                   searchable inside), two tabs, forty commands (some bound to a chord); what a scene is is driven by the probe with real key presses
//   ?case=perf      one probe-only provider of 1,000 host rows (`bulk`), the tabs and the commands: what a keystroke costs with a thousand rows registered
//   ?case=runs      the geometry's sources and five that fail (a `match` that throws), so the status band has more runs than it shows
//
// `window.__palette` is the model's store; `window.__scoped = true` makes the palette open narrowed to the tab on screen's plugin and scope (S69); `window.__commits` lists every commit of the tree (React's
// profiler; the probe builds this entry with the development build of React DOM for the counts); `window.__announced` lists what the live region was told; `window.__tabs` is the tab model.
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { createAnnouncer, createPaletteStore, seedChips, type PaletteBindings, type PaletteCandidate, type PaletteSource } from '..';
import { StaticShell, staticTabs, STATIC_RAIL } from '../testing';

const params = new URLSearchParams(window.location.search);
const CASE = params.get('case') ?? 'geometry';

const tabs = staticTabs(
  [
    { title: 'Widgets', icon: 'box', path: ['Acme', 'north', 'Widgets'], scope: 'north' },
    { title: 'Gadgets', icon: 'layers', path: ['Acme', 'north', 'Gadgets'], scope: 'north' },
  ],
  0,
);
Reflect.set(window, '__tabs', tabs);

const announcer = createAnnouncer();
const announced: string[] = [];
Reflect.set(window, '__announced', announced);

const GLYPHS = ['box', 'layers', 'server', 'folder-tree', 'columns', 'clock', 'scroll-text'] as const;
const route = (contribution: string) => ({ plugin: 'acme', contribution });

/** Seven plugin homes, each searchable inside; only the first says where it is (the mock's empty list: a context on its first row). */
const homes: readonly PaletteCandidate[] = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'].map((name, index) => ({
  id: `home:${name.toLowerCase()}`,
  kind: 'home' as const,
  title: name,
  noun: 'Plugin home',
  icon: GLYPHS[index % GLYPHS.length],
  context: index === 0 ? 'Overview' : '',
  route: route(`home-${name.toLowerCase()}`),
  into: { kind: 'scope' as const, id: name.toLowerCase(), label: name },
}));

/** Eight pages with a context each; the last four are searchable inside (the mock's suggestions: a muted column, and a chevron on some rows). */
const pages: readonly PaletteCandidate[] = ['Gadgets', 'Widgets', 'Sprockets', 'Cogs', 'Valves', 'Gears', 'Levers', 'Pulleys'].map((name, index) => ({
  id: `page:${name.toLowerCase()}`,
  kind: 'page' as const,
  title: name,
  icon: GLYPHS[index % GLYPHS.length],
  context: index < 4 ? 'Acme' : 'Hardware',
  route: route(name.toLowerCase()),
  ...(index < 4 ? {} : { into: { kind: 'type' as const, id: name.toLowerCase(), label: name } }),
}));

const CATEGORIES = ['Tabs', 'Panel', 'Window', 'View', 'Search'] as const;
const VERBS = ['Open', 'Close', 'Toggle', 'Show', 'Hide', 'Refresh', 'Copy', 'Find'] as const;
const NOUNS = ['tab', 'panel', 'window', 'sidebar', 'log', 'view'] as const;
/**
 * Forty commands, in the mock's order of magnitude: a verb and a noun, a category as the context, and a chord on every third one. The first has a chord as wide as the widest the mock's list has (56.02 px at 12 px),
 * which sets the width of the trailing column. It is plain ASCII (`Ctrl+Alt+O`) so that the same width comes out on every machine: the probe sets the font to Helvetica and Arial, as the mock's reference was measured,
 * and the signs of a Command chord then come from whichever font the machine has (Lucida Grande on a Mac), so the one that sets a column's width must not be one.
 */
const commands: readonly PaletteCandidate[] = Array.from({ length: 40 }, (_, index) => ({
  id: `cmd.${String(index)}`,
  kind: 'command' as const,
  title: `${VERBS[index % VERBS.length] ?? 'Open'} ${NOUNS[Math.floor(index / VERBS.length)] ?? 'tab'}`,
  context: CATEGORIES[index % CATEGORIES.length],
  icon: index % 2 === 0 ? 'close' : 'panel-bottom',
  command: { id: `cmd.${String(index)}` },
  ...(index % 3 === 0 ? { shortcut: index === 0 ? 'Ctrl+Alt+O' : index % 6 === 0 ? '⌘W' : '⌘J' } : {}),
}));

/** What the host's own tabs provider says: one tab for each open tab, with the context the shell's real provider writes. */
const tabsSource = (): readonly PaletteCandidate[] => {
  const { order, tabs: all, active } = tabs.getSnapshot();
  return order.map((id) => {
    const tab = all[id];
    const route = tab?.location.route;
    const where = ['north', 'Everything', 'Window 1'].join(' · ');
    return {
      id,
      kind: 'tab' as const,
      title: tab?.face.title ?? '?',
      icon: tab?.face.icon,
      tab: id,
      context: id === active ? `${where} · Current tab` : where,
      matchContext: where,
      route: route?.kind === 'extension-view' ? undefined : route,
    };
  });
};

/** Words for the bulk provider: titles of two or three of them, so a query of one to eight characters ranks a thousand candidates and finds some. */
const WORDS = ['alpha', 'bravo', 'cedar', 'delta', 'ember', 'fjord', 'garnet', 'harbor', 'indigo', 'juniper', 'kernel', 'lantern', 'meadow', 'nickel', 'orchid', 'pepper', 'quartz', 'raven', 'saffron', 'tundra'] as const;
const bulk: readonly PaletteCandidate[] = Array.from({ length: 1000 }, (_, index) => {
  const first = WORDS[index % WORDS.length] ?? 'alpha';
  const second = WORDS[(index * 7 + 3) % WORDS.length] ?? 'bravo';
  return { id: `bulk:${String(index)}`, kind: 'page' as const, title: `${first} ${second} ${String(index)}`, context: `Group ${String(index % 13)}`, icon: GLYPHS[index % GLYPHS.length], route: route(`bulk-${String(index)}`) };
});

const failing = (id: string, name: string): PaletteSource => ({
  id: `${id}:pages`,
  plugin: id,
  pluginName: name,
  title: 'Pages',
  section: 'goto',
  match: (): never => {
    throw new Error('It is down.');
  },
});

const store = createPaletteStore({
  open: (destination, options) => tabs.open(destination, options),
  activate: (id) => tabs.activate(id),
  run: () => true,
  announce: (text) => {
    announced.push(text);
    announcer.announce(text);
  },
  platform: /mac/i.test(navigator.platform) ? 'mac' : 'other',
  // The mock's footer has five open keys, so the geometry is compared with five: the host's palette leaves `windows` off and says four.
  windows: true,
  onError: () => undefined,
});
Reflect.set(window, '__palette', store);

const sources: PaletteSource[] =
  CASE === 'perf'
    ? [
      { id: 'host:bulk', plugin: 'host', pluginName: 'Omniview', title: 'Bulk', section: 'goto', match: () => bulk },
      { id: 'host:tabs', plugin: 'host', pluginName: 'Omniview', title: 'Tabs', section: 'tabs', match: tabsSource },
      { id: 'host:commands', plugin: 'host', pluginName: 'Omniview', title: 'Commands', section: 'commands', match: () => commands },
    ]
    : [
      { id: 'acme:pages', plugin: 'acme', pluginName: 'Acme Cloud', pluginIcon: 'layers', title: 'Pages', section: 'goto', match: () => pages },
      { id: 'acme:homes', plugin: 'acme', pluginName: 'Acme Cloud', pluginIcon: 'layers', title: 'Homes', section: 'goto', match: () => homes },
      { id: 'host:tabs', plugin: 'host', pluginName: 'Omniview', title: 'Tabs', section: 'tabs', match: tabsSource },
      { id: 'host:commands', plugin: 'host', pluginName: 'Omniview', title: 'Commands', section: 'commands', match: () => commands },
      ...(CASE === 'runs' ? ['One', 'Two', 'Three', 'Four', 'Five'].map((name) => failing(`bad-${name.toLowerCase()}`, name)) : []),
    ];
for (const source of sources) {
  store.registerProvider(source);
}

const palette: PaletteBindings = {
  store,
  announcer,
  // The palette opens narrowed to the tab on screen's place when the probe says it is opened from inside one (S69).
  opening: () => (Reflect.get(window, '__scoped') === true ? { scope: seedChips({ plugin: 'acme', pluginName: 'Acme Cloud', pluginIcon: 'layers', scope: { id: 'north', label: 'north · Everything' }, scopeIcon: 'server' }) } : {}),
};

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
      <StaticShell registration={{ plugin: { name: 'Acme' }, rail: STATIC_RAIL }} tabs={tabs} palette={palette}>
        <button type="button">A control in the page</button>
      </StaticShell>
    </Profiler>
    <TooltipHost />
  </ThemeProvider>,
);
