import { useMenu, type MenuItem } from '@omniviewdev/kit';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { copyToClipboard, dispositionOf, platformOf, type ModifierEvent } from '../../shell';
import type { OpenHow } from '../../shell/core/tabs';
import type { ConnectionsState, HostConnections, RecentConnection } from './connections';
import type { PluginSource } from './contributions';
import { Home, type HomeAnnouncement, type HomeConnectionRow, type HomeProps } from './Home';
import { homeConnectionsOf, homeEntriesOf } from './homeModel';
import { HOME_PAGE_ID, type HostPageDefinition, type HostPageProps } from './hostPages';

// Home as a page of the host (HM1, HM2; ch16 S8, S9, S34: "Home is an ordinary tab and several may exist"): the same content the empty window shows (decision A17), in a tab. `HomeContent` is that one content: both draw it, so they
// cannot differ. It reads what the window knows (the plugins, the connections, the ones used last), shapes it for the page (`homeModel.ts`), and decides what a choice means; `Home` draws what it is given. A window with no connection
// API (`connections` absent) lists none and says nothing of them.

/** What a window with no connection API reads: nothing, ever. */
const NONE: ConnectionsState = { loaded: true, failed: false, connections: [] };
const NO_CONNECTIONS = {
  subscribe: (): (() => void) => () => undefined,
  getSnapshot: (): ConnectionsState => NONE,
};

const NO_USES: readonly RecentConnection[] = [];
const NO_RECENTS = {
  subscribe: (): (() => void) => () => undefined,
  getSnapshot: (): readonly RecentConnection[] => NO_USES,
};

const PLATFORM = platformOf(navigator);

/** Why Open is refused on a row whose start is under way: said on the item itself, where the person looks, and not by an item that does nothing. */
const STILL_CONNECTING = 'This connection is still connecting. Open it when it has connected.';
const COPY_FAILED = 'Couldn\'t copy the name. The clipboard isn\'t available here.';

type HomeContentProps = {
  /** The window's plugin store: the plugins Home offers and the connections of the ones that contribute. */
  readonly plugins: PluginSource;
  /** What the window knows of the connections and what choosing one does. Absent: the window has none, and Home lists none. */
  readonly connections: HostConnections | undefined;
  /** The window has no tab: Home says so under its title. */
  readonly empty: boolean;
  /** A plugin was chosen: its id, and the click or key that chose it. */
  readonly onOpenPlugin: HomeProps['onOpenPlugin'];
};

/**
 * What Home is, wherever it is drawn: the tab's page and the empty window both draw THIS (decision A17).
 *
 * THE MENU OF A ROW is defined here (`useMenu`) and Home only makes each row a context trigger of it, keyed by the row's record (its plugin and key, `homeModel.ts`), never by its element. The menu host resolves the key when the menu opens,
 * against the rows as they are then, so the items are the connection's own: Open and Open in new tab start it if it needs starting and open it (`actions.go`, as a press on the row does), and Copy name puts its name on the clipboard and says
 * so. A connection whose start is under way is refused, on the items and with the reason, not silently; and a menu that is open when a connection starts connecting is put away, because what it offered is not so any more (`revision`).
 *
 * THE HANDLERS ARE THE SAME BETWEEN RENDERS (`useCallback`), as Home's rows are drawn again when one changes (`Home.tsx`, WHAT IT COSTS).
 */
export function HomeContent({ plugins, connections, empty, onOpenPlugin }: HomeContentProps) {
  const entries = useSyncExternalStore(plugins.subscribe, plugins.getSnapshot);
  const source = connections?.store ?? NO_CONNECTIONS;
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const lately = connections?.recents ?? NO_RECENTS;
  const used = useSyncExternalStore(lately.subscribe, lately.getSnapshot);
  const offered = useMemo(() => homeEntriesOf(entries), [entries]);
  const model = useMemo(() => homeConnectionsOf(entries, state.connections, used), [entries, state.connections, used]);
  const [said, setSaid] = useState<HomeAnnouncement | undefined>(undefined);

  const go = useCallback(
    (plugin: string, key: string, how: OpenHow): void => {
      void connections?.actions.go(plugin, key, { how, source: 'home' });
    },
    [connections],
  );
  const open = useCallback(
    (plugin: string, key: string, event: ModifierEvent | undefined): void => {
      go(plugin, key, dispositionOf(event, { platform: PLATFORM }));
    },
    [go],
  );
  const retry = useCallback((): void => {
    void connections?.store.refresh();
  }, [connections]);
  const tell = useCallback((text: string): void => {
    setSaid((before) => ({ serial: (before?.serial ?? 0) + 1, text }));
  }, []);

  const itemsOf = (row: HomeConnectionRow): readonly MenuItem[] => {
    const refused = row.busy === true ? STILL_CONNECTING : false;
    return [
      {
        kind: 'action',
        id: 'open',
        label: 'Open',
        disabled: refused,
        onSelect: () => {
          go(row.plugin, row.key, 'smart');
        },
      },
      {
        kind: 'action',
        id: 'open-new',
        label: 'Open in new tab',
        disabled: refused,
        onSelect: () => {
          go(row.plugin, row.key, 'new');
        },
      },
      { kind: 'separator', id: 'copy-separator' },
      {
        kind: 'action',
        id: 'copy-name',
        label: 'Copy name',
        onSelect: () => {
          void copyToClipboard(row.name).then((copied) => {
            tell(copied ? `Copied ${row.name}` : COPY_FAILED);
          });
        },
      },
    ];
  };

  // The connections whose start is under way: what the items of an open menu depend on. A start that begins or ends puts an open menu away; any other change of a connection leaves it where it is.
  const starting = useMemo(() => JSON.stringify([...model.rows.values()].filter((row) => row.busy === true).map((row) => row.id)), [model]);
  const menu = useMenu((contextKey) => {
    const row = contextKey === undefined ? undefined : model.rows.get(contextKey);
    return row === undefined ? undefined : itemsOf(row);
  }, starting);

  return (
    <Home
      entries={offered}
      recent={model.recent}
      groups={model.groups}
      connections={state.loaded ? (state.failed ? 'failed' : 'ready') : 'loading'}
      empty={empty}
      menu={menu}
      announcement={said}
      onOpenPlugin={onOpenPlugin}
      onOpenConnection={open}
      onRetry={retry}
    />
  );
}

function HomePage({ plugins, connections, openPlugin }: HostPageProps) {
  return <HomeContent plugins={plugins} connections={connections} empty={false} onOpenPlugin={openPlugin} />;
}

/** The Home page, registered with the window's host pages (`PluginHost.tsx`). */
export const homePage: HostPageDefinition = { id: HOME_PAGE_ID, title: 'Home', icon: 'house', singleton: false, layout: 'document', Page: HomePage };
