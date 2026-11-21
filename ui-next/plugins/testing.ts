import { openSession, SESSION_VERSION, type LoadedSession } from '../shell/session';
import type { ContributionV1, ContextV1, ListPageV1, ListPageViewV1 } from './contract/v1';
import { HOME_PAGE } from './host/contributions';
import type { EventSource } from './host/lifecycle';
import type { PluginEntry } from './host/pluginStore';
import { railOf } from './host/rail';

// Test support: a good contribution of an invented plugin (Acme, widgets), built the way a bundle builds its own. Nothing but tests imports this.

export type Widget = { readonly key: string; readonly name: string };

export const WIDGETS: readonly Widget[] = [
  { key: 'a', name: 'alpha' },
  { key: 'b', name: 'beta' },
];

/** A page whose data hook is `use`; its title is `title`. */
export function widgetPage(title: string, use: (context: ContextV1) => ListPageViewV1<Widget>): ListPageV1<Widget> {
  return {
    kind: 'list',
    definition: {
      title,
      nouns: { one: title, other: title },
      columns: [{ id: 'name', header: 'Name', fit: 'flex', width: 160, text: (row) => row.name, cell: (row) => row.name }],
      lines: 1,
      getRowKey: (row) => row.key,
      searchText: (row) => row.name,
    },
    usePage: use,
  };
}

/** The hook of a page that answers `rows` as a finished read. */
export const answering =
  (rows: readonly Widget[], crumb = 'Widgets') =>
    (context: ContextV1): ListPageViewV1<Widget> => ({
      frame: {
        tab: { title: crumb, icon: 'box' },
        path: ['Acme', crumb],
        scope: [{ label: 'Connection', icon: 'server', text: context.route.connection ?? 'none' }],
      },
      source: { state: { kind: 'ready' }, rows, complete: true, refreshing: false, refresh: async () => undefined },
    });

export function acme(patch: Partial<ContributionV1> = {}): ContributionV1 {
  return {
    plugin: { name: 'Acme', accent: 'blue' },
    rail: true,
    sidebar: {
      label: 'Acme navigation',
      title: 'Acme',
      nodes: [
        {
          id: 'group',
          label: 'Group',
          icon: 'layers',
          children: [
            { id: 'widgets', label: 'Widgets', icon: 'box' },
            { id: 'gadgets', label: 'Gadgets', icon: 'box' },
          ],
        },
      ],
    },
    pages: { widgets: widgetPage('Widgets', answering(WIDGETS)), gadgets: widgetPage('Gadgets', answering([{ key: 'g', name: 'gizmo' }], 'Gadgets')) },
    home: 'widgets',
    ...patch,
  };
}

/**
 * The window as a previous run left it: one tab on the first plugin of the declared order, at the plugin's home page, and nothing else. Since step S3a no page opens by itself (decision A17: the
 * window is empty unless a session brings its tabs back), so a test that is about a tab on screen starts from a session that holds one. `undefined` when there is no plugin to hold a tab of.
 */
export function startedOn(entries: readonly PluginEntry[]): LoadedSession | undefined {
  const first = railOf(entries)[0]?.id ?? entries[0]?.id;
  const entry = entries.find((candidate) => candidate.id === first);
  if (entry === undefined) {
    return undefined;
  }

  const route = { plugin: entry.id, contribution: entry.phase === 'ready' ? entry.contribution.home : HOME_PAGE, params: {} };
  const text = JSON.stringify({
    version: SESSION_VERSION,
    tabs: { version: 1, active: 'started', tabs: [{ id: 'started', route, key: `${entry.id}:${route.contribution}`, pinned: false, preview: false }] },
    rail: null,
    panel: { version: 1 },
  });
  return openSession({ read: async () => text, write: async () => undefined, keep: async () => undefined }, text);
}

type EventHandler = (event: { readonly data?: unknown }) => void;

export type FakeEvents = {
  /** What the listener under test is given. */
  readonly source: EventSource;
  /** The host says something to the window: every handler of the name is called with the data. */
  readonly emit: (name: string, data?: unknown) => void;
  /** The handlers on now, whatever the name. */
  readonly held: () => number;
  /** The names that have a handler on, sorted. */
  readonly names: () => string[];
};

/**
 * The runtime's `Events`, as a table of handlers a test calls: what the host says to the window (`plugin/unloaded`, `plugin/state_change`) is `emit`ted by the test, and `held` counts the handlers that
 * are on now, so a test sees a listener that is never removed. No runtime, no host.
 */
export function fakeEvents(): FakeEvents {
  const handlers = new Map<string, Set<EventHandler>>();
  const source: EventSource = {
    On: (name, callback) => {
      const set = handlers.get(name) ?? new Set<EventHandler>();
      handlers.set(name, set);
      set.add(callback);
      return () => {
        set.delete(callback);
      };
    },
  };
  return {
    source,
    emit: (name, data) => {
      for (const handler of [...(handlers.get(name) ?? [])]) {
        handler({ data });
      }
    },
    held: () => [...handlers.values()].reduce((total, set) => total + set.size, 0),
    names: () =>
      [...handlers.entries()]
        .filter(([, set]) => set.size > 0)
        .map(([name]) => name)
        .sort(),
  };
}
