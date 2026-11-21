// The shell with invented registrations and invented tabs, for the probe (shell-probe.mjs): the frame with every region, which is the subject of the probe's comparison with the mock, the
// strip at any number of tabs, and the cases no real screen shows. It is a second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it, because that
// build has ui-next/index.html as its only input. The tab model is the real one (core/tabs); only what describes a route is invented (testing.tsx).
//
//   ?case=full      every region, a count on the entry, an empty page: the frame the mock's reference screen is compared with (every target of targets.mjs), and the count's geometry
//   ?case=bare      no rail, sidebar or scope lane: the frame with only what every screen has
//   ?case=long      text longer than its room in the tab, the tree, the lane and the path
//   ?case=deep      a tree of three levels and enough rows to scroll
//   ?case=scroll    a page taller than the island
//   ?case=names&names=<json>   a sidebar whose one open group holds the entries the probe names, `[{ id, label, count }]` with `count` a number, `{ value, approximate: true }` or absent: the rows whose rooms the
//                   long-name comparison with the mock reads (strip-probe.mjs, section `names`), and what a label that is cut says when it is pointed at (this case mounts the window's one tooltip)
//   ?case=injected  the registration a probe puts in `window.__registration` before the page runs, an empty page: the frame compared with the mock's reference screen
//   ?case=tabs&tabs=N&active=K   N tabs (default 5), the K-th on screen (default the last); `window.__tabs` is the model, `window.__commits` counts the commits of every render
//   ?case=titles&pages=<json>   the tabs the probe names, `[{ title, scope? }]`, the first on screen: the text of the strip against the mock's (strip-probe.mjs, sections `titles` and `twins`; strip-text-cases.mjs)
//   ?case=panel     the frame `full` and the bottom panel (panel/testing.tsx: the real model over the five tools the mock's host offers, the first of which has a `+`), closed; `window.__panel` is the model
//                   a probe opens, fills and resizes, and `window.__lines()` reads every stream body's count; `window.__opened` lists the addresses a session card's link was asked to open (A21: a link that
//                   cannot open must not appear in it)
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { Button, ThemeProvider, TooltipHost, type IconName } from '@omniviewdev/kit';
import { createRoot } from 'react-dom/client';
import { Profiler, type ReactNode } from 'react';
import type { ShellRegistration, ShellTreeNode } from '..';
import { staticTabs, StaticShell, STATIC_RAIL, type StaticPage } from '../testing';
import type { ToolInput } from '../core/panel';
import { StreamBody, staticPanel } from '../panel/testing';

/** What a case registers: the frame, and the words of its one tab. */
type Described = ShellRegistration & { readonly tab: { readonly title: string; readonly icon: IconName }; readonly path: readonly string[] };

const full: Described = {
  plugin: { name: 'Acme' },
  tab: { title: 'Entries', icon: 'box' },
  path: ['Acme', 'north', 'Entries'],
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

const words = 'A name much too long for the room it is given, in every place a name is drawn';

const deep: Described = {
  ...full,
  sidebar: {
    label: 'Acme resources',
    title: 'Resources',
    nodes: Array.from({ length: 40 }, (_, index) => ({
      id: `g${index}`,
      label: `Group ${index}`,
      icon: 'layers' as const,
      children: [
        { id: `g${index}-a`, label: `Entry ${index}`, icon: 'box' as const, count: index },
        { id: `g${index}-b`, label: `Nested ${index}`, icon: 'box' as const, children: [{ id: `g${index}-b-x`, label: `Leaf ${index}`, icon: 'box' as const }] },
      ],
    })),
    open: ['g0', 'g0-b'],
    current: 'g0-a',
  },
};

/** The entries of `?case=names`, as the probe wrote them in the address. */
type NamedEntry = { readonly id: string; readonly label: string; readonly count?: ShellTreeNode['count'] };
const named: Described = {
  ...full,
  sidebar: {
    label: 'Acme names',
    title: 'Names',
    nodes: [
      {
        id: 'g',
        label: 'Group',
        icon: 'layers',
        children: (JSON.parse(new URLSearchParams(window.location.search).get('names') ?? '[]') as readonly NamedEntry[]).map(({ id, label, count }) => ({ id, label, icon: 'box' as const, ...(count === undefined ? {} : { count }) })),
      },
    ],
    open: ['g'],
    current: undefined,
  },
};

type Case = { readonly described: Described; readonly page: () => ReactNode };

const cases: Record<string, Case> = {
  full: { described: full, page: () => <></> },
  bare: { described: { plugin: { name: 'Acme' }, tab: { title: 'Home', icon: 'box' }, path: ['Acme', 'Home'] }, page: () => <p>A page.</p> },
  long: {
    described: {
      ...full,
      tab: { title: words, icon: 'box' },
      path: ['Acme ' + words, 'north ' + words, 'Entries ' + words],
      sidebar: { ...full.sidebar!, nodes: [{ id: 'group', label: words, icon: 'layers', children: [{ id: 'entry', label: words, icon: 'box', count: 1234567 }] }] },
      scope: [
        { label: 'Connection', icon: 'server', text: words },
        { label: 'Scope', icon: 'folder-tree', text: words },
      ],
    },
    page: () => <p>{words}</p>,
  },
  deep: { described: deep, page: () => <p>A page.</p> },
  names: { described: named, page: () => <></> },
  // The registration a probe injects as `window.__registration` before the page runs (the words of the mock's reference screen, which the probe owns): this file names none.
  injected: { described: (Reflect.get(window, '__registration') as Described | undefined) ?? full, page: () => <></> },
  scroll: {
    described: full,
    page: () => (
      <div>
        {Array.from({ length: 300 }, (_, index) => (
          <p key={index}>Line {index}</p>
        ))}
      </div>
    ),
  },
  tabs: { described: full, page: () => <p>A page.</p> },
  titles: { described: full, page: () => <p>A page.</p> },
  panel: { described: full, page: () => <></> },
};

/** The tools of the mock's host, in its order, under the kit's glyphs (the registry has none for a terminal or a log yet: every glyph is 16 px, which is all a tab's width reads). Names of the host's own tools, no plugin's. */
const PANEL_TOOLS: readonly ToolInput[] = [
  { id: 'terminal', label: 'Terminal', icon: 'server', order: 10 },
  { id: 'logs', label: 'Logs', icon: 'layers', order: 20 },
  { id: 'ports', label: 'Ports', icon: 'columns', order: 30 },
  { id: 'problems', label: 'Problems', icon: 'status-warning', order: 40 },
  { id: 'operations', label: 'Operations', icon: 'clock', order: 50 },
];

const params = new URLSearchParams(window.location.search);
const chosen = cases[params.get('case') ?? 'full'] ?? cases.full;
const Page = chosen.page;
const { tab, path, ...registration } = chosen.described;

/** The tabs of a case: one for a frame case; N for `?case=tabs`, each a page of its own, so no two read alike unless the probe asks. */
const many = params.get('case') === 'tabs';
/** `?case=titles`: the tabs a probe names in the address, each a page of its own (a title and, when two read alike, the scope that tells them apart). */
const titled = params.get('case') === 'titles';
const titledPages = titled ? (JSON.parse(params.get('pages') ?? '[]') as ReadonlyArray<{ readonly title: string; readonly scope?: string }>) : [];
const count = many ? Math.max(1, Number(params.get('tabs') ?? '5')) : 1;
const pages: StaticPage[] = titled
  ? titledPages.map(({ title, scope }) => ({ title, icon: 'box' as const, path: ['Acme', title], scope }))
  : many
    ? Array.from({ length: count }, (_, index) => ({ title: `Page ${String(index + 1)}`, icon: 'box' as const, path: ['Acme', `Page ${String(index + 1)}`] }))
    : [{ title: tab.title, icon: tab.icon, path }];
const tabs = staticTabs(pages, many ? Math.min(count, Math.max(1, Number(params.get('active') ?? count))) - 1 : 0);
Reflect.set(window, '__tabs', tabs);

/** `?case=panel`: the bottom panel over the real model; `+` of the first tool starts `session-01`, `session-02`, ... A terminal's card says what the mock's says of a local shell. */
let started = 0;
const opened: string[] = [];
Reflect.set(window, '__opened', opened);
const panel =
  params.get('case') === 'panel'
    ? staticPanel({
      tools: PANEL_TOOLS,
      start: {
        terminal: {
          label: 'New terminal',
          open: () => {
            started += 1;
            return { title: `session-${String(started).padStart(2, '0')}`, state: 'running' };
          },
        },
      },
      // A body with one control of its own, as a body that has a toolbar has: the keyboard path goes on into it after the strip. A plugin's body draws its controls with the kit's parts, as every body is
      // to: a raw native button here took the browser's own colours on the dark surface (Linux WebKit: axe `color-contrast`, serious).
      renderBody: (session, visible) => (
        <>
          <StreamBody session={session} visible={visible} />
          <Button data-fixture="body-stop">Pause</Button>
        </>
      ),
      // A session called `tall` has more facts than any window has room for: its card is clamped to the room and scrolls (the kit's hover card).
      cardOf: (session) =>
        session.tool === 'terminal'
          ? {
            kind: 'Shell',
            facts: session.title === 'tall' ? Array.from({ length: 40 }, (_, index) => [`Fact ${String(index + 1)}`, `Value ${String(index + 1)}`] as const) : [['Target', 'Local shell (zsh)'], ['Details', 'This computer']],
            state: session.state === 'running' ? { label: 'Connected' } : undefined,
            actions: session.state === 'running' ? [{ label: 'Stop', onSelect: () => undefined }] : [],
          }
          : undefined,
      // Where the link of a card goes: nowhere in a fixture, but a probe reads what it was asked to open (`window.__opened`, the addresses in order), so a link that cannot open is seen not to.
      linkOf: (route) => ({
        href: `#/${route.plugin}/${route.contribution}`,
        open: () => {
          opened.push(`${route.plugin}/${route.contribution}`);
        },
      }),
    })
    : undefined;
Reflect.set(window, '__panel', panel?.store);
Reflect.set(window, '__lines', () => Object.fromEntries([...document.querySelectorAll('[data-fixture="stream"]')].map((el) => [el.getAttribute('data-session'), Number(el.getAttribute('data-lines'))])));

// Every commit of the shell's tree, so a probe can count what a tab switch costs. React's Profiler calls this once per commit that rendered something under it.
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
      <StaticShell
        registration={registration}
        tabs={tabs}
        panel={panel}
        onNewTab={
          many || titled
            ? () => {
              // The strip's `+`: a new page after the last one, through the model (the host's `+` opens a plugin's home page the same way).
              tabs.open({ route: { plugin: 'acme', contribution: `p${String(tabs.getSnapshot().order.length)}` } }, { how: 'new' });
            }
            : undefined
        }
      >
        <Page />
      </StaticShell>
    </Profiler>
    {/* The one tooltip of the window, where the case reads what a label that is cut says when it is pointed at. */}
    {params.get('case') === 'names' ? <TooltipHost /> : null}
  </ThemeProvider>,
);
