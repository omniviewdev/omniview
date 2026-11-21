// The real shell with the real toast layer over invented sources, for the probe (notices-probe.mjs): the window with its rail, sidebar, scope lane, tab strip, the bottom panel (the real model over invented tools)
// and the command palette (the real model and view over a few invented providers), and a store of notices that the probe raises records on. The shell, the toast layer (`Toasts`), the notices model, the panel model
// and the palette model are the product's own; only what a page, a panel body, a provider or a producer says is invented. A second HTML entry that the probe builds on its own; `vite build` of the channel never
// reaches it.
//
//   ?case=real      (default) the store runs on the platform's real timers: geometry, placement, keyboard, announcements and performance read this
//   ?case=clock     the store runs on a clock the probe drives (`window.__clock.advance(ms)`, core/notices/testing): what a toast lives for and what holds it, in no time and in the same order on every run.
//                   The view's own timers (the 120 ms it waits before it asks whether the pointer left, and before it decides the placement again) stay real: they are the view's, not the model's
//   &centre=1       the window has a notification centre (`NoticesBindings.centre`): the summary toast has its Show, as the mock's has (a toast is 70 px tall then)
//
// What the page exposes: `window.__notices` the store, `window.__panel` the panel model, `window.__palette` the palette model, `window.__tabs` the tab model, `window.__clock` (`?case=clock`), `window.__commits` every
// commit of the shell's tree (React's Profiler; the probe builds this entry with the development build of React DOM for the counts), `window.__announced` what the model and the view asked the two live regions to
// say, in order (`{ kind: 'polite' | 'assertive', text }`: the seam; what the DOM carried is the probe's own recorder, installed before this script runs), `window.__centre` how many times the summary toast's Show
// asked for the centre, `window.__errors` what the model reported of a plugin's code that threw.
// Wired as the host wires it (ui-next/plugins/host/notices.ts): while the palette is open the stack waits (`hold('modal')`), and when it closes the stack comes back.
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { Button, ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { createAnnouncer, createNoticesAnnouncer, createNoticesStore, createPaletteStore, type NoticesAnnouncer, type NoticesBindings, type PaletteBindings, type PaletteCandidate, type PaletteSource, type ShellRegistration } from '..';
import { manualClock } from '../core/notices/testing';
import type { ToolInput } from '../core/panel';
import { staticPanel } from '../panel/testing';
import { StaticShell, STATIC_RAIL, staticTabs } from '../testing';

const params = new URLSearchParams(window.location.search);
const CASE = params.get('case') ?? 'real';

// One tab: the page host keeps the pages of the other tabs mounted and hidden, with the same words, so the page's controls would be there twice.
const tabs = staticTabs([{ title: 'Widgets', icon: 'box', path: ['Acme', 'north', 'Widgets'], scope: 'north' }], 0);
Reflect.set(window, '__tabs', tabs);

const registration: ShellRegistration = {
  plugin: { name: 'Acme' },
  rail: STATIC_RAIL,
  sidebar: {
    label: 'Acme resources',
    title: 'Resources',
    nodes: [{ id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'entry', label: 'Entry', icon: 'box', count: 89 }] }],
    open: ['group'],
    current: 'entry',
  },
  scope: [
    { label: 'Connection', icon: 'server', text: 'north' },
    { label: 'Scope', icon: 'folder-tree', text: 'Everything' },
  ],
};

// What the model and the view asked the live regions to say: one announcer, so every path (the model's records that have no toast, the view's stack that has no room) is in this list.
const announced: Array<{ readonly kind: 'polite' | 'assertive'; readonly text: string }> = [];
Reflect.set(window, '__announced', announced);
const base = createNoticesAnnouncer();
const announcer: NoticesAnnouncer = {
  ...base,
  announce: (text, options) => {
    announced.push({ kind: options.urgent ? 'assertive' : 'polite', text });
    base.announce(text, options);
  },
};

const centre = { asked: 0 };
Reflect.set(window, '__centre', centre);
const errors: Array<{ readonly where: string; readonly message: string }> = [];
Reflect.set(window, '__errors', errors);
const clock = CASE === 'clock' ? manualClock() : undefined;
Reflect.set(window, '__clock', clock);

const store = createNoticesStore({
  ...(clock === undefined ? {} : { scheduler: clock.scheduler }),
  announce: announcer.announce,
  openCenter: () => {
    centre.asked += 1;
  },
  onError: (error, where) => {
    errors.push({ where, message: String(error) });
  },
  platform: /mac/i.test(navigator.platform) ? 'mac' : 'other',
});
Reflect.set(window, '__notices', store);
const notices: NoticesBindings = { store, announcer, centre: params.get('centre') === '1' };

// The command palette: the real model over a few invented providers, as the palette probe's fixture has them (a handful of places, the tabs and a few commands).
const GLYPHS = ['box', 'layers', 'server', 'folder-tree'] as const;
const route = (contribution: string) => ({ plugin: 'acme', contribution });
const pages: readonly PaletteCandidate[] = ['Gadgets', 'Widgets', 'Sprockets', 'Cogs'].map((name, index) => ({
  id: `page:${name.toLowerCase()}`,
  kind: 'page' as const,
  title: name,
  icon: GLYPHS[index % GLYPHS.length],
  context: 'Acme',
  route: route(name.toLowerCase()),
}));
const commands: readonly PaletteCandidate[] = ['Open tab', 'Close tab', 'Toggle panel', 'Show log'].map((title, index) => ({
  id: `cmd.${String(index)}`,
  kind: 'command' as const,
  title,
  context: 'Tabs',
  icon: 'panel-bottom',
  command: { id: `cmd.${String(index)}` },
}));
const sources: readonly PaletteSource[] = [
  { id: 'acme:pages', plugin: 'acme', pluginName: 'Acme Cloud', pluginIcon: 'layers', title: 'Pages', section: 'goto', match: () => pages },
  { id: 'host:commands', plugin: 'host', pluginName: 'Omniview', title: 'Commands', section: 'commands', match: () => commands },
];
const paletteAnnouncer = createAnnouncer();
const palette = createPaletteStore({
  open: (destination, options) => tabs.open(destination, options),
  activate: (id) => tabs.activate(id),
  run: () => true,
  announce: paletteAnnouncer.announce,
  platform: /mac/i.test(navigator.platform) ? 'mac' : 'other',
  onError: () => undefined,
});
for (const source of sources) {
  palette.registerProvider(source);
}

Reflect.set(window, '__palette', palette);
const paletteBindings: PaletteBindings = { store: palette, announcer: paletteAnnouncer, opening: () => ({}) };

// While the palette is open the stack waits (ch16 S89a), and it comes back when the palette closes: the host's own wiring (ui-next/plugins/host/notices.ts, `attach`).
let held = false;
palette.subscribe(() => {
  const open = palette.getSnapshot().open;
  if (open !== held) {
    held = open;
    store.hold('modal', open);
  }
});

// The bottom panel: the real model over the host's five tools, one session open, with the invented stream body of panel/testing.tsx. Its own controls are the panel's (the tool tabs, the session tab, the Hide button at its right end): a
// stack of three toasts with buttons stands where the Hide button is when the panel is open, which is where the real shell has a control for a stack at home to meet.
const PANEL_TOOLS: readonly ToolInput[] = [
  { id: 'terminal', label: 'Terminal', icon: 'server', order: 10 },
  { id: 'logs', label: 'Logs', icon: 'layers', order: 20 },
  { id: 'ports', label: 'Ports', icon: 'columns', order: 30 },
  { id: 'problems', label: 'Problems', icon: 'status-warning', order: 40 },
  { id: 'operations', label: 'Operations', icon: 'clock', order: 50 },
];
const panel = staticPanel({ tools: PANEL_TOOLS, sessions: [{ tool: 'terminal', title: 'zsh', state: 'running' }] });
Reflect.set(window, '__panel', panel.store);

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
      <StaticShell registration={registration} tabs={tabs} panel={panel} palette={paletteBindings} notices={notices}>
        <div data-fixture="page">
          <Button data-fixture="page-control">A control in the page</Button>
          <Button data-fixture="page-other">Another control</Button>
        </div>
      </StaticShell>
    </Profiler>
    <TooltipHost />
  </ThemeProvider>,
);
