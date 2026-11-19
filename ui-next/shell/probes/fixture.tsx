// The shell with invented registrations and invented tabs, for the probe (shell-probe.mjs): the frame with every region, which is the subject of the probe's comparison with the mock, the
// strip at any number of tabs, and the cases no real screen shows. It is a second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it, because that
// build has ui-next/index.html as its only input. The tab model is the real one (core/tabs); only what describes a route is invented (testing.tsx).
//
//   ?case=full      every region, a count on the entry, an empty page: the frame the mock's reference screen is compared with (every target of targets.mjs), and the count's geometry
//   ?case=bare      no rail, sidebar or scope lane: the frame with only what every screen has
//   ?case=long      text longer than its room in the tab, the tree, the lane and the path
//   ?case=deep      a tree of three levels and enough rows to scroll
//   ?case=scroll    a page taller than the island
//   ?case=injected  the registration a probe puts in `window.__registration` before the page runs, an empty page: the frame compared with the mock's reference screen
//   ?case=tabs&tabs=N&active=K   N tabs (default 5), the K-th on screen (default the last); `window.__tabs` is the model, `window.__commits` counts the commits of every render
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider, type IconName } from '@omniviewdev/kit';
import { createRoot } from 'react-dom/client';
import { Profiler, type ReactNode } from 'react';
import type { ShellRegistration } from '..';
import { staticTabs, StaticShell, STATIC_RAIL, type StaticPage } from '../testing';

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
};

const params = new URLSearchParams(window.location.search);
const chosen = cases[params.get('case') ?? 'full'] ?? cases.full;
const Page = chosen.page;
const { tab, path, ...registration } = chosen.described;

/** The tabs of a case: one for a frame case; N for `?case=tabs`, each a page of its own, so no two read alike unless the probe asks. */
const many = params.get('case') === 'tabs';
const count = many ? Math.max(1, Number(params.get('tabs') ?? '5')) : 1;
const pages: StaticPage[] = many ? Array.from({ length: count }, (_, index) => ({ title: `Page ${String(index + 1)}`, icon: 'box' as const, path: ['Acme', `Page ${String(index + 1)}`] })) : [{ title: tab.title, icon: tab.icon, path }];
const tabs = staticTabs(pages, many ? Math.min(count, Math.max(1, Number(params.get('active') ?? count))) - 1 : 0);
Reflect.set(window, '__tabs', tabs);

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
        onNewTab={
          many
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
  </ThemeProvider>,
);
