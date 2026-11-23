import type { Route, TabId, TabsStore } from '../../../shell';
import { connectionOf, type PluginSource } from '../contributions';
import type { PluginEntry } from '../pluginStore';
import type { ConnectionsStore } from './store';

// What choosing a connection does (HM1): the one place the chip's picker, Home and the palette meet, so that all three say the same thing and fail the same way. A connection that is not connected is started FIRST, by the host, with
// the store saying "connecting" while it runs and why it failed when it did (`store.ts`); only a connection that is connected is routed to. A page is never left to start the connection it finds stopped: the person has said which one
// they want, and the window says what became of it where they said it.
//
//   `switchTab`  the tab on screen goes to another connection of ITS plugin: the same page when the page is a list (the lists change), the list the page belongs to when it is an object's page (the object is the old connection's), and
//                the change replaces the tab's history entry, as a change of scope does (ch16 S60). The tab keeps its place, its pin, and its panel sessions: sessions of the host's tools belong to the host (A21).
//   `go`         from anywhere (Home): the plugin's own first page in that connection, in a tab, by the open model's rules (a tab that already shows it is shown).
//   `goOrSwitch` from the palette: `switchTab` when the tab on screen is the connection's plugin's, else `go`.

type Ready = Extract<PluginEntry, { readonly phase: 'ready' }>;
type OpenOptions = NonNullable<Parameters<TabsStore['open']>[1]>;

/** What an action came to: done, or why not, in a sentence a person reads (the palette says it, the picker's row already says what the store knows). */
export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type ConnectionActions = {
  /** The tab goes to another connection of its plugin. Resolves when it has, or when it could not. A later choice for the same tab supersedes this one: the earlier answers `ok` and changes nothing. */
  readonly switchTab: (tab: TabId, key: string) => Promise<ActionResult>;
  /** The plugin's first page in the connection, opened in a tab by the open model. */
  readonly go: (plugin: string, key: string, options: OpenOptions) => Promise<ActionResult>;
  /** The palette's row: the tab on screen goes there when it is the plugin's, else a tab opens. */
  readonly goOrSwitch: (plugin: string, key: string) => Promise<ActionResult>;
};

export type ConnectionActionsDeps = {
  readonly tabs: TabsStore;
  readonly plugins: PluginSource;
  readonly connections: ConnectionsStore;
};

const NOT_AVAILABLE = 'This plugin is not available.';
const UNSAVED = 'This tab has unsaved changes.';

export function createConnectionActions({ tabs, plugins, connections }: ConnectionActionsDeps): ConnectionActions {
  const readyEntry = (plugin: string): Ready | undefined => {
    const entry = plugins.getSnapshot().find((candidate) => candidate.id === plugin);
    return entry?.phase === 'ready' ? entry : undefined;
  };

  /** The plugin's own first page, in the connection. */
  const homeIn = (entry: Ready, key: string): Route => ({ plugin: entry.id, contribution: entry.contribution.home, params: { connection: key } });

  /**
   * Where a tab of the plugin goes when its connection changes: the page it is on, in the new connection, when that page is a list; the list an object's page belongs to when it is a detail page (the object is the old
   * connection's, and the new one has no page for it); the plugin's first page when the tab is on a page the plugin no longer has.
   */
  const targetOf = (entry: Ready, from: Route, key: string): Route => {
    const { pages } = entry.contribution;
    if (!Object.hasOwn(pages, from.contribution)) {
      return homeIn(entry, key);
    }

    const page = pages[from.contribution];
    if (page?.kind === 'detail') {
      const list = page.definition.list?.page;
      return list !== undefined && Object.hasOwn(pages, list) ? { plugin: entry.id, contribution: list, params: { connection: key } } : homeIn(entry, key);
    }

    return { plugin: entry.id, contribution: from.contribution, params: { connection: key } };
  };

  const answerOf = (result: { readonly status: string; readonly message?: string }): ActionResult => {
    if (result.status === 'refused') {
      return { ok: false, reason: result.message ?? NOT_AVAILABLE };
    }

    return result.status === 'confirm' ? { ok: false, reason: UNSAVED } : { ok: true };
  };

  const latest = new Map<TabId, symbol>();

  const switchTab: ConnectionActions['switchTab'] = async (tab, key) => {
    const from = tabs.getSnapshot().tabs[tab]?.location.route;
    if (from === undefined) {
      return { ok: false, reason: 'This tab is closed.' };
    }

    const token = Symbol(key);
    latest.set(tab, token);
    const outcome = await connections.connect(from.plugin, key);
    // Another choice was made for this tab while this one connected: that one is the answer, whether this one connected or failed.
    if (latest.get(tab) !== token) {
      return { ok: true };
    }

    latest.delete(tab);
    if (outcome.status === 'failed') {
      return { ok: false, reason: outcome.reason };
    }

    // The tab may have moved on while the connection started (another page, another plugin, closed): where it is now is where the change applies, and a tab that left the plugin is left alone.
    const now = tabs.getSnapshot().tabs[tab]?.location.route;
    const entry = readyEntry(from.plugin);
    if (now?.plugin !== from.plugin) {
      return { ok: true };
    }

    if (entry === undefined) {
      return { ok: false, reason: NOT_AVAILABLE };
    }

    if (connectionOf(now) === key) {
      return { ok: true };
    }

    return answerOf(tabs.navigate(tab, { route: targetOf(entry, now, key) }, { history: 'replace', source: 'connection' }));
  };

  const go: ConnectionActions['go'] = async (plugin, key, options) => {
    const outcome = await connections.connect(plugin, key);
    if (outcome.status === 'failed') {
      return { ok: false, reason: outcome.reason };
    }

    const entry = readyEntry(plugin);
    return entry === undefined ? { ok: false, reason: NOT_AVAILABLE } : answerOf(tabs.open({ route: homeIn(entry, key) }, options));
  };

  const goOrSwitch: ConnectionActions['goOrSwitch'] = async (plugin, key) => {
    const { active, tabs: all } = tabs.getSnapshot();
    if (active !== null && all[active]?.location.route.plugin === plugin) {
      return switchTab(active, key);
    }

    return go(plugin, key, { how: 'smart', source: 'palette' });
  };

  return { switchTab, go, goOrSwitch };
}
