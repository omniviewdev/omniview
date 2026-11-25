import '@omniviewdev/kit/styles.css';
import '../../../global.css';
import { MenuHost, ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { Profiler, useLayoutEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createRecents, type ActionResult, type ConnectionActions, type ConnectionState, type ConnectionsState, type ConnectionsStore, type HostConnection, type HostConnections } from '../connections';
import type { PluginSource } from '../contributions';
import { HomeContent } from '../homePage';
import type { PluginEntry } from '../pluginStore';
import { COUNT, PLUGIN, connectionsOf } from './home-world.mjs';
import styles from './home-fixture.module.css';

// The real Home content (`HomeContent`, homePage.tsx) over a fake host, for the cost probe (home-perf.mjs): a fake `HostConnections` whose connections the page can change (`window.__host`), a plugin source with ONE plugin, the real kit's
// `ThemeProvider`, `MenuHost` and `TooltipHost`, and two Profilers that count commits: `window.__pageCommits` (a commit that rendered something inside Home) and `window.__commits` (a commit of anything under the theme, the menu host included).
// `?count=<n>` sets how many connections there are (default 200); `?names=long` gives every one a name of more than eighty characters.

const params = new URLSearchParams(window.location.search);
const count = Number(params.get('count') ?? COUNT);

/** What a person changes of a connection, by its key: what the host's store would say after a read. */
type Change = { readonly key: string } & Partial<Pick<HostConnection, 'state' | 'reason' | 'name' | 'detail'>>;

function createStore(initial: readonly HostConnection[]): ConnectionsStore & { readonly change: (changes: readonly Change[]) => void } {
  let state: ConnectionsState = { loaded: true, failed: false, connections: initial };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: async () => Promise.resolve(),
    connect: async () => Promise.resolve({ status: 'connected' as const }),
    attach: () => () => undefined,
    // As the real store keeps a connection that did not change the same object (`reuse`), only the connections that changed are new objects; the list is a new array.
    change: (changes) => {
      const connections = state.connections.map((connection) => {
        const change = changes.find((candidate) => candidate.key === connection.key);
        return change === undefined ? connection : { ...connection, ...change };
      });
      state = { ...state, connections };
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

const store = createStore(connectionsOf(count, { long: params.get('names') === 'long' }));
const calls = { go: [] as Array<readonly [string, string]>, openPlugin: [] as string[] };
const worked = async (): Promise<ActionResult> => Promise.resolve({ ok: true });
const actions: ConnectionActions = {
  switchTab: worked,
  go: async (plugin, key) => {
    calls.go.push([plugin, key]);
    return worked();
  },
  goOrSwitch: worked,
};
const connections: HostConnections = { store, recents: createRecents(), actions };

const entries: readonly PluginEntry[] = [
  {
    id: PLUGIN.id,
    name: PLUGIN.name,
    phase: 'ready',
    contribution: { plugin: { name: PLUGIN.name, accent: undefined }, rail: { icon: 'layers', order: undefined }, sidebar: { label: PLUGIN.name, title: PLUGIN.name, nodes: [] }, pages: {}, home: 'items' },
  },
];
const plugins: PluginSource = {
  getSnapshot: () => entries,
  subscribe: () => () => undefined,
};

type Commit = { readonly phase: string; readonly actualDuration: number; readonly at: number };
const commits: Commit[] = [];
const pageCommits: Commit[] = [];

/** A commit the probe can force (a lever for its controls only): a state change of a component that draws nothing, inside the page's Profiler, so that the page's profiler sees a commit and the document is not changed. */
const levers = { bump: (): void => undefined };

function Tick(): null {
  const [, set] = useState(0);
  useLayoutEffect(() => {
    levers.bump = () => {
      flushSync(() => {
        set((value) => value + 1);
      });
    };
  }, []);
  return null;
}

function Page(): ReactNode {
  return (
    <div className={styles.page} data-home-fixture="">
      <Profiler
        id="home"
        onRender={(_id, phase, actualDuration) => {
          pageCommits.push({ phase, actualDuration, at: performance.now() });
        }}
      >
        <HomeContent
          plugins={plugins}
          connections={connections}
          empty={false}
          onOpenPlugin={(id) => {
            calls.openPlugin.push(id);
          }}
        />
        <Tick />
      </Profiler>
    </div>
  );
}

Reflect.set(window, '__host', {
  change: (changes: readonly Change[]): void => {
    store.change(changes);
  },
  states: (): ReadonlyArray<readonly [string, ConnectionState]> => store.getSnapshot().connections.map((connection) => [connection.key, connection.state] as const),
  calls,
  bump: (): void => {
    levers.bump();
  },
});
Reflect.set(window, '__commits', commits);
Reflect.set(window, '__pageCommits', pageCommits);

createRoot(document.getElementById('root')!).render(
  <ThemeProvider themeId={params.get('theme') ?? undefined}>
    <Profiler
      id="window"
      onRender={(_id, phase, actualDuration) => {
        commits.push({ phase, actualDuration, at: performance.now() });
      }}
    >
      <MenuHost>
        <Page />
      </MenuHost>
    </Profiler>
    <TooltipHost />
  </ThemeProvider>,
);
