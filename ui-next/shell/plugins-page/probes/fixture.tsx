// The real window with the real Plugins page over a fake host, for the probe (plugins-probe.mjs): the product's own `PluginHost` (the shell, the rail, the tab model, the palette and its command "Plugins", the page host) around the plugin
// store the window really has (`PluginStore`, `listenForLifecycle`, the inventory read into the one query client), and `createPluginsPage` registered in place of the production page (`registerHostPage`). What is invented is the host: its
// inventory (the six plugins of world.mjs, and as many generated ones as `?count=` asks for), the calls the page makes of it and the events it tells the window, which happen in the order the host's code does them
// (docs/ui-next/status/PL1.md, "What the backend can tell the page TODAY"). A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
//   ?count=6          how many plugins are installed: the six of world.mjs first, then generated ones (`plugin-0007`...), all running; 0 is a host that has none
//   ?loaded=6         how many of them the window loads an interface for (the first ones). Loading hundreds of interfaces is the window's own cost and the rail's, not the page's, and every number the probe takes is the page's
//   ?readMs=20        how long the host takes to answer an inventory read (a bound call), after the window's first frame
//   ?seed=0           the probe's negative control `late-list`: the page is registered without its seed, so that its first frame has no list and the list comes when the host answers (`?readMs=` later): the fault of a page that does not draw the
//                     inventory the window already holds
//   ?actionMs=150     how long each action the page asks for takes, once it is let go
//   ?theme=void       the theme the window starts in (a probe changes it later with the root attribute, as the kit's own probes do)
//   #/host/plugins    the address of the page: the window opens it as it opens any link (the palette's command "Plugins" is the other way, and the one a person uses)
//
// The six plugins are in the states of world.mjs: `alpha`, `beta` and `zeta` run, `delta` was turned off, `epsilon` is starting (the inventory says so), and `gamma` crashed after the window had loaded it (the host told the window, as it does: the
// window's store holds it as stopped, the inventory as Failed).
//
// What the page exposes to the probe: `window.__world` (the host: `hold(op)` keeps the next call of `reload`, `setEnabled`, `uninstall` or the start of a retry until `release(op)`, `calls` is every call made, `reads()` every inventory read,
// `set(id, patch)` changes a record the host holds without saying a word (a window that opens later reads it), `add`, `remove`, `crash(id)`, `phase(id, to)` changes a phase and tells the window), `window.__events` (what the host tells the
// window: `emit(name, data)`, `held()`, `names()`), `window.__store` (the window's plugin store) and, from the development build only (the Profiler calls nothing in a production build), `window.__commits` (every commit of the tree) and
// `window.__pageCommits` (every commit that rendered something inside the Plugins page), each `{ phase, actualDuration, at }`; the window's commits also say how many rows of the list were in the document at the end of the commit (`rows`).
import '@omniviewdev/kit/styles.css';
import '../../../global.css';
import { MenuHost, ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Profiler, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ContributionV1 } from '../../../plugins/contract/v1';
import { registerHostPage, type HostPageProps } from '../../../plugins/host/hostPages';
import { describePlugins } from '../../../plugins/host/inventory';
import { listenForLifecycle } from '../../../plugins/host/lifecycle';
import { PluginHost } from '../../../plugins/host/PluginHost';
import { PluginStore, type LoaderDeps } from '../../../plugins/host/pluginStore';
import { useHashLink } from '../../../plugins/host/route';
import { INVENTORY_KEY } from '../../../plugins/host/useInstalledPlugins';
import { acme, fakeEvents } from '../../../plugins/testing';
import { createQueryClient } from '../../../queryClient';
import type { PluginActions } from '../core/model';
import type { InventoryEntry } from '../core/types';
import { productionDeps } from '../host';
import { createPluginsPage } from '../PluginsPage';
import { WORLD, type WorldPlugin } from './world.mjs';

const params = new URLSearchParams(window.location.search);
const number = (name: string, fallback: number): number => Number(params.get(name) ?? fallback);
const COUNT = number('count', WORLD.length);
const LOADED = number('loaded', WORLD.length);
const READ_MS = number('readMs', 20);
const ACTION_MS = number('actionMs', 150);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The plugins the host has: the invented ones of world.mjs, then generated ones as far as `?count=` goes. A generated plugin is a healthy one, named by its number so that it sorts after the first six. */
function installedOf(count: number): readonly WorldPlugin[] {
  const generated = (index: number): WorldPlugin => {
    const number_ = String(index + 1).padStart(4, '0');
    return {
      id: `plugin-${number_}`,
      name: `Zz Fixture ${number_}`,
      version: '1.0.0',
      publisher: 'Fixture Labs',
      category: 'Fixture',
      license: 'Apache-2.0',
      summary: 'A generated plugin: it makes the list as long as it is for a person who installed a great many.',
      state: 'running',
    };
  };

  return [...WORLD, ...Array.from({ length: Math.max(0, count - WORLD.length) }, (_, index) => generated(WORLD.length + index))].slice(0, count);
}

/** The inventory entry of a plugin as the host sends it (`PluginInfo`): its manifest, its phase, whether the person turned it off. `delta` is off, `epsilon` is starting. */
function recordOf(plugin: WorldPlugin): InventoryEntry {
  return {
    id: plugin.id,
    origin: 'external',
    enabled: plugin.state !== 'disabled',
    phase: plugin.state === 'disabled' ? 'Installed' : plugin.state === 'starting' ? 'Starting' : 'Running',
    devMode: false,
    releaseChannel: '',
    metadata: {
      name: plugin.name,
      version: plugin.version,
      description: plugin.summary,
      category: plugin.category,
      license: plugin.license,
      author: { name: plugin.publisher },
      repository: '',
      website: '',
      tags: [],
      dependencies: [],
      capabilities: ['resource', 'log'],
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The host: its inventory, and what it does when the page asks.

const events = fakeEvents();
const { emit } = events;
const records = new Map<string, InventoryEntry>(installedOf(COUNT).map((plugin) => [plugin.id, recordOf(plugin)]));
const held = new Set<string>();
const gates = new Map<string, () => void>();
const calls = { reload: [] as string[], setEnabled: [] as Array<readonly [string, boolean]>, uninstall: [] as string[], retry: [] as string[] };
let reads = 0;

/** A call the probe holds waits here until it is let go; one it does not hold goes on at once. */
async function gate(operation: string): Promise<void> {
  if (held.has(operation)) {
    await new Promise<void>((resolve) => {
      gates.set(operation, resolve);
    });
  }
}

/** Changes a phase in the host's record, and tells the window as the host does (`plugin/state_change`). */
function enter(id: string, to: string): void {
  const record = records.get(id);
  if (record === undefined) {
    return;
  }

  records.set(id, { ...record, phase: to });
  emit('plugin/state_change', { pluginID: id, from: record.phase, to });
}

/** The plugin runs again after a reload or a retry: the host stores its record again and says so. The window loads the interface again when it hears it. */
function run(id: string, record: InventoryEntry): void {
  records.set(id, { ...record, phase: 'Starting' });
  enter(id, 'Running');
}

const actions: PluginActions = {
  // ReloadPlugin: the plugin stops, the host deletes its record for the whole of the load (the inventory lists none until it ends), the window is told the plugin is starting again, and then that it runs.
  reload: async (id) => {
    calls.reload.push(id);
    const record = records.get(id);
    if (record === undefined) {
      throw new Error('{"type":"omniview:plugin/not-loaded","title":"Plugin not loaded","status":404}');
    }

    emit('plugin/state_change', { pluginID: id, from: record.phase, to: 'Stopped' });
    emit('plugin/unloaded', { pluginID: id, cause: 'reloaded' });
    records.delete(id);
    await gate('reload');
    await sleep(ACTION_MS);
    run(id, record);
  },
  // SetPluginEnabled: the choice is persisted and told, and turning a plugin off says it is unloaded BEFORE the teardown, which then moves the phase twice. Turning one on starts nothing: the page follows it with a reload.
  setEnabled: async (id, enabled) => {
    calls.setEnabled.push([id, enabled]);
    await gate('setEnabled');
    const record = records.get(id);
    if (record === undefined) {
      throw new Error('plugin not found');
    }

    records.set(id, { ...record, enabled, phase: enabled ? 'Installed' : record.phase });
    emit('plugin/enablement_changed', { pluginID: id, enabled });
    if (!enabled) {
      emit('plugin/unloaded', { pluginID: id, cause: 'disabled' });
      await sleep(ACTION_MS);
      enter(id, 'Stopped');
      enter(id, 'Installed');
    }
  },
  // UninstallPlugin: the window is told the plugin is being uninstalled before the plugin is disposed of, and then that the inventory changed (no payload).
  uninstall: async (id) => {
    calls.uninstall.push(id);
    await gate('uninstall');
    emit('plugin/unloaded', { pluginID: id, cause: 'uninstalled' });
    await sleep(ACTION_MS);
    records.delete(id);
    emit('plugin/inventory_changed');
  },
};

const world = {
  hold: (operation: string): void => {
    held.add(operation);
  },
  release: (operation: string): void => {
    held.delete(operation);
    gates.get(operation)?.();
    gates.delete(operation);
  },
  calls,
  reads: (): number => reads,
  list: (): readonly InventoryEntry[] => [...records.values()],
  set: (id: string, patch: Partial<Pick<InventoryEntry, 'phase' | 'enabled'>>): void => {
    const record = records.get(id);
    if (record !== undefined) {
      records.set(id, { ...record, ...patch });
    }
  },
  add: (plugin: WorldPlugin): void => {
    records.set(plugin.id, recordOf(plugin));
  },
  remove: (id: string): void => {
    records.delete(id);
  },
  /** The plugin's process died and the host gave up recovering it: the window is told it stopped unexpectedly, and the phase is Failed. */
  crash: (id: string): void => {
    emit('plugin/unloaded', { pluginID: id, cause: 'crashed' });
    enter(id, 'Failed');
  },
  phase: enter,
};

/** PluginManager.ListPlugins: the host answers after its own time, with what it holds now. */
async function read(): Promise<readonly InventoryEntry[]> {
  reads += 1;
  await sleep(READ_MS);
  return [...records.values()];
}

// ---------------------------------------------------------------------------------------------------------------------------
// The window: its plugin store, over interfaces that load at once.

const contributionOf = (plugin: WorldPlugin | undefined, id: string): ContributionV1 =>
  acme({ plugin: { name: plugin?.name ?? id, accent: plugin !== undefined && ['alpha', 'beta', 'epsilon'].includes(id) ? 'teal' : undefined }, rail: { icon: 'box' } });

const known = new Map(installedOf(COUNT).map((plugin) => [plugin.id, plugin]));
const loader: LoaderDeps = {
  importBundle: async (id) => ({ contributionV1: contributionOf(known.get(id), id) }),
  clearBundle: () => undefined,
  log: () => undefined,
};

/** RetryFailedPlugin: the host starts the plugin again and answers whether it runs. */
const store = new PluginStore(loader, 5, async (id) => {
  calls.retry.push(id);
  const record = records.get(id);
  await gate('retry');
  await sleep(ACTION_MS);
  if (record !== undefined) {
    run(id, record);
  }

  return true;
});

// `useInstalledPlugins` reads the inventory into the one query client and reads it again after these events; the real hook calls the runtime, so the same two lines are here over the fake host.
const INVENTORY_EVENTS = ['plugin/init_complete', 'plugin/inventory_changed', 'plugin/install_finished', 'plugin/update_complete', 'plugin/enablement_changed'] as const;

function Screen(): ReactNode {
  const queryClient = useQueryClient();
  const link = useHashLink();
  useEffect(() => {
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
    };

    const stops = INVENTORY_EVENTS.map((name) => events.source.On(name, invalidate));
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [queryClient]);
  const query = useQuery({ queryKey: INVENTORY_KEY, queryFn: read });
  const plugins = useMemo(() => describePlugins(query.data ?? []), [query.data]);
  useEffect(() => listenForLifecycle(store, events.source), []);
  // The plugins are handed to the store before the screen is painted, in the commit the list arrives in (`PluginHostScreen`).
  useLayoutEffect(() => {
    for (const plugin of plugins.slice(0, LOADED)) {
      void store.load(plugin);
    }
  }, [plugins]);
  // A plugin that crashed after the window had loaded it: the host tells the window once its interface is there (the second of the six that is in the states of world.mjs).
  useEffect(
    () =>
      store.subscribe(() => {
        for (const plugin of WORLD) {
          if (plugin.state === 'failed' && records.get(plugin.id)?.phase === 'Running' && store.getSnapshot().some((entry) => entry.id === plugin.id && entry.phase === 'ready')) {
            world.crash(plugin.id);
          }
        }
      }),
    [],
  );

  return (
    <PluginHost
      plugins={store}
      inventory={query.status === 'success' ? 'ready' : query.status === 'error' ? 'failed' : 'loading'}
      link={link}
      onRetry={(id) => {
        const plugin = plugins.find((candidate) => candidate.id === id);
        if (plugin !== undefined) {
          void store.retry(plugin);
        }
      }}
      onRetryInventory={() => {
        void query.refetch();
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// The page, over the fake host, in place of the production registration; and the counts of commits the development build gives.

type Commit = { readonly phase: string; readonly actualDuration: number; readonly at: number };
// A commit of the window also says how many rows of the list were in the document when it ended (a Profiler's `onRender` runs after the commit's DOM changes), so that a probe can say in which commit after a command the list came.
type WindowCommit = Commit & { readonly rows: number };
const commits: WindowCommit[] = [];
const pageCommits: Commit[] = [];
const page = createPluginsPage({ read, actions, events: events.source, seed: params.get('seed') === '0' ? undefined : productionDeps.seed });
const PluginsPage = page.Page;
registerHostPage({
  ...page,
  Page: (props: HostPageProps) => (
    <Profiler
      id="plugins-page"
      onRender={(_id, phase, actualDuration) => {
        pageCommits.push({ phase, actualDuration, at: performance.now() });
      }}
    >
      <PluginsPage {...props} />
    </Profiler>
  ),
});

Reflect.set(window, '__world', world);
Reflect.set(window, '__events', { emit, held: events.held, names: events.names });
Reflect.set(window, '__store', store);
Reflect.set(window, '__commits', commits);
Reflect.set(window, '__pageCommits', pageCommits);

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider themeId={params.get('theme') ?? undefined}>
      <Profiler
        id="window"
        onRender={(_id, phase, actualDuration) => {
          commits.push({ phase, actualDuration, at: performance.now(), rows: document.querySelectorAll('[data-pl-part="row"]').length });
        }}
      >
        <MenuHost>
          <Screen />
        </MenuHost>
      </Profiler>
      <TooltipHost />
    </ThemeProvider>
  </QueryClientProvider>,
);
