import type { IconName } from '@omniviewdev/kit';
import { useState, type ReactNode } from 'react';
import { createTabsStore, type TabsStore } from './core/tabs';
import type { NoticesBindings } from './notices/host';
import type { PaletteBindings } from './palette/host';
import type { PanelBindings } from './panel/host';
import type { ShellRail, ShellRegistration } from './registration';
import { Shell } from './Shell';

// Test and probe support: a shell around tabs that are plain data, with an invented plugin (Acme) behind them, so a test or a probe can draw the frame without a plugin host. Nothing in the
// product imports this file; the shell's tests, its probe's fixture and the page probe's fixture do. The tab model is the real one: only what describes a route is invented.

/** A tab's face as a test writes it. */
export type StaticPage = {
  readonly title: string;
  readonly icon: IconName;
  /** The status bar's crumbs, root first. */
  readonly path: readonly string[];
  /** The connection the page is read in, which a tab that reads like another is told apart by. */
  readonly scope?: string | undefined;
};

const PLUGIN = 'acme';

/** A rail of three invented places, the first of them current: what a fixture registers where the product's frame has a rail. */
export const STATIC_RAIL: ShellRail = {
  label: 'Plugins',
  entries: [
    { id: 'acme', label: 'Acme', icon: 'box' },
    { id: 'beta', label: 'Beta', icon: 'layers' },
    { id: 'gamma', label: 'Gamma', icon: 'server' },
  ],
  current: 'acme',
};

/** A tab model whose tabs are `pages`, in order, with `active` (an index) on screen. The pages are `p0`, `p1`, ... of the plugin `acme`. */
export function staticTabs(pages: readonly StaticPage[], active = 0): TabsStore {
  const store = createTabsStore({
    contributions: {
      describe: (route) => {
        const page = pages[Number(route.contribution.slice(1))];
        return page === undefined
          ? undefined
          : { title: page.title, icon: page.icon, path: page.path, pluginName: 'Acme', scope: page.scope === undefined ? undefined : { id: page.scope, label: page.scope }, facets: page.scope === undefined ? [] : [page.scope] };
      },
      home: () => ({ plugin: PLUGIN, contribution: 'p0' }),
    },
  });
  pages.slice(1).forEach((_page, index) => store.open({ route: { plugin: PLUGIN, contribution: `p${String(index + 1)}` } }, { how: 'new' }));
  store.goto(active + 1);
  return store;
}

type StaticShellProps = {
  readonly registration: ShellRegistration;
  /** The tabs. Default: one page, Widgets. */
  readonly tabs?: TabsStore | undefined;
  /** What the strip's new-tab control does. Absent: no control. */
  readonly onNewTab?: (() => void) | undefined;
  /** What choosing an entry of the rail does. Absent: nothing. */
  readonly onSelectRail?: ((id: string) => void) | undefined;
  /** What the close chord does with no tab on screen. Absent: nothing. */
  readonly onCloseWindow?: (() => void) | undefined;
  /** The bottom panel (`staticPanel`, ./panel/testing.tsx). Absent: the window has none. */
  readonly panel?: PanelBindings | undefined;
  /** The command palette (`palette/host.ts`). Absent: the window has none, and no Search control. */
  readonly palette?: PaletteBindings | undefined;
  /** The toast layer (`notices/host.ts`). Absent: the window has none. */
  readonly notices?: NoticesBindings | undefined;
  /** The page of every tab. */
  readonly children?: ReactNode;
};

/** The shell with the same page in every tab. */
export function StaticShell({ registration, tabs, onNewTab, onSelectRail, onCloseWindow, panel, palette, notices, children }: StaticShellProps) {
  const [store] = useState(() => tabs ?? staticTabs([{ title: 'Widgets', icon: 'box', path: ['Acme', 'Widgets'] }]));
  return <Shell registration={registration} tabs={store} renderPage={() => <>{children}</>} empty={null} onNewTab={onNewTab} onSelectRail={onSelectRail} onCloseWindow={onCloseWindow} panel={panel} palette={palette} notices={notices} />;
}
