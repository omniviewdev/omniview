// The shell with invented registrations, for the probe (shell-probe.mjs): cases the one real screen cannot show. It is a second HTML entry that
// the probe builds on its own; `vite build` of the channel never reaches it, because that build has ui-next/index.html as its only input.
//
//   ?case=full      every region, a count on the entry, an empty page: the empty frame, and the count's geometry
//   ?case=bare      no rail, sidebar or scope lane: the frame with only what every screen has
//   ?case=long      text longer than its room in the tab, the tree, the lane and the path
//   ?case=deep      a tree of three levels and enough rows to scroll
//   ?case=scroll    a page taller than the island
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider } from '@omniviewdev/kit';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { Shell, type ShellRegistration } from '..';

const full: ShellRegistration = {
  plugin: { name: 'Acme' },
  tab: { title: 'Entries', icon: 'box' },
  path: ['Acme', 'north', 'Entries'],
  rail: true,
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

const deep: ShellRegistration = {
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

const cases: Record<string, { registration: ShellRegistration; page: () => ReactNode }> = {
  full: { registration: full, page: () => <></> },
  bare: { registration: { plugin: { name: 'Acme' }, tab: { title: 'Home', icon: 'box' }, path: ['Acme', 'Home'] }, page: () => <p>A page.</p> },
  long: {
    registration: {
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
  deep: { registration: deep, page: () => <p>A page.</p> },
  scroll: {
    registration: full,
    page: () => (
      <div>
        {Array.from({ length: 300 }, (_, index) => (
          <p key={index}>Line {index}</p>
        ))}
      </div>
    ),
  },
};

const chosen = cases[new URLSearchParams(window.location.search).get('case') ?? 'full'] ?? cases.full;
const Page = chosen.page;

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <Shell registration={chosen.registration}>
      <Page />
    </Shell>
  </ThemeProvider>,
);
