import type { Route, TabId, TabsStore } from '../../../shell';
import { navigationOrigin, type ExtensionViewRoute } from '../../../shell/core/tabs';
import type { ExtensionBinding } from '../extensionAuthority';
import { connectionOf, readsNoConnection, type PluginSource } from '../contributions';
import type { PluginEntry } from '../pluginStore';
import type { ConnectionsStore } from './store';

// What choosing a connection does (HM1): the one place the chip's picker, Home and the palette meet, so that all three say the same thing and fail the same way. A connection that is not connected is started FIRST, by the host, with
// the store saying "connecting" while it runs and why it failed when it did (`store.ts`); only a connection that is connected is routed to. A page is never left to start the connection it finds stopped: the person has said which one
// they want, and the window says what became of it where they said it.
//
//   `switchTab`  the tab on screen goes to another connection of ITS plugin: the same page when the page is a list or an overview (the page of a scope: the new connection has its own), the list the page belongs to when it is an object's page (the object is the old connection's), and
//                the change replaces the tab's history entry, as a change of scope does (ch16 S60). The tab keeps its place, its pin, and its panel sessions: sessions of the host's tools belong to the host (A21). A place is one tab (ch16 S26): when another tab already shows
//                where it would go, that tab is shown and this one keeps its own connection, as `go` does (N4 of the review of HM3b: there were two tabs on one place, named alike).
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
  /** Re-read this mounted leaf's declaration, admission and collisions. Never resolve it as an ordinary page. */
  readonly viewBinding?: ((route: ExtensionViewRoute) => ExtensionBinding | undefined) | undefined;
};

const NOT_AVAILABLE = 'This plugin is not available.';
const UNSAVED = 'This tab has unsaved changes.';

export function createConnectionActions({ tabs, plugins, connections, viewBinding }: ConnectionActionsDeps): ConnectionActions {
  const readyEntry = (plugin: string): Ready | undefined => {
    const entry = plugins.getSnapshot().find((candidate) => candidate.id === plugin);
    return entry?.phase === 'ready' ? entry : undefined;
  };

  /** The plugin's own first page, in the connection. */
  const homeIn = (entry: Ready, key: string): Route => ({ plugin: entry.id, contribution: entry.contribution.home, params: { connection: key } });

  /**
   * Where a tab of the plugin goes when its connection changes: the page it is on, in the new connection, when that page is a list, an overview or a custom page of a connection (the page of a scope, which the new connection has as well); the list an object's page belongs to when it is a detail
   * page (the object is the old connection's, and the new one has no page for it); the plugin's first page when the tab is on a page the plugin no longer has, and when it is on a page that is read in no connection (the landing: there is no connection to change, and the person chose one).
   */
  const targetOf = (entry: Ready, from: Route, key: string): Route => {
    const { pages } = entry.contribution;
    if (!Object.hasOwn(pages, from.contribution) || readsNoConnection(pages[from.contribution])) {
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

    const origin = from.kind === 'extension-view' ? navigationOrigin(tabs.getSnapshot()) : undefined;
    const witness = from.kind === 'extension-view' ? viewBinding?.(from) : undefined;
    if (from.kind === 'extension-view') {
      const list = connections.getSnapshot();
      if (origin?.id !== tab || !witness || !list.loaded || list.failed || !list.connections.some(row => row.plugin === from.plugin && row.key === key)) {
        return { ok: false, reason: 'View unavailable.' };
      }
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

    if (from.kind === 'extension-view') {
      const route: ExtensionViewRoute = { ...from, connection: key };
      const list = connections.getSnapshot();
      if (!list.loaded || list.failed || !list.connections.some(row => row.plugin === from.plugin && row.key === key && row.state === 'connected' && row.busy === undefined) ||
          viewBinding?.(route) !== witness) {
        return { ok: false, reason: 'View unavailable.' };
      }

      return answerOf(tabs.navigate(tab, { route }, { history: 'replace', source: 'connection', reuse: true, origin }));
    }

    if (now.kind === 'extension-view') {
      return { ok: true };
    }

    if (connectionOf(now) === key) {
      return { ok: true };
    }

    // `reuse`: the open model shows a tab that already shows the destination's place, and leaves this tab where it is, instead of making a second tab of that place.
    return answerOf(tabs.navigate(tab, { route: targetOf(entry, now, key) }, { history: 'replace', source: 'connection', reuse: true }));
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
