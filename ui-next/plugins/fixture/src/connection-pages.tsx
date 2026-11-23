import { Button, Text, type DataTableColumn } from '@omniviewdev/kit';
import { useMemo } from 'react';
import type { ContextV1, FrameV1, ListPageV1, ListPageViewV1, ListSource, PanelHostV1 } from '../../contract/v1';
import { connectionFace, useChosenConnection, type PageConnection } from './connection';
import { connectionLogTargetOf } from './logs';

// The page of the connections fixture: one list whose three rows depend on the connection the route names, read the way a plugin with real connections reads it (connection.ts). The rows are static,
// keyed by the connection's NAME: the backend (../connections-process) serves the same names, and the host starts a connection before it routes to it, so the page reads no resource. The name of a row is a button that
// opens the item's Logs session through the panel handle the host gave the page (`ContextV1.panel`, as a plugin's row action does): the proof that a session belongs to the host's panel and not to the connection the
// page was read in (decision A21: it stays when the tab goes to another connection).

export type ConnectionItem = {
  /** The identity of the row in the list: the connection and the name. */
  readonly id: string;
  readonly name: string;
  /** The name of the connection the row belongs to. */
  readonly connection: string;
  /** Opens the item's Logs session in the host's panel. Absent when the host gave the page no panel handle: the name is then plain text. */
  readonly logs?: (() => void) | undefined;
};

const NAMES: Readonly<Record<string, readonly string[]>> = {
  north: ['orders-api', 'ledger-sync', 'billing-sync'],
  south: ['harbor-gate', 'tide-table', 'keel-check'],
};

/** The rows of a connection, by its name; none for a name the fixture does not know. With `panel`, each row can open its Logs session. */
export function itemsOf(connection: string | undefined, panel: PanelHostV1 | undefined = undefined): readonly ConnectionItem[] {
  if (connection === undefined) {
    return [];
  }

  return (NAMES[connection] ?? []).map((name) => ({
    id: `${connection}/${name}`,
    name,
    connection,
    logs:
      panel === undefined
        ? undefined
        : () => {
          panel.logs.open(connectionLogTargetOf(connection, name));
        },
  }));
}

const PLUGIN_NAME = 'Seam Connections';
const TITLE = 'Items';

/** How the page sits in the frame: the tab, the status bar's path and the scope lane. */
export function itemsFrame(connection: Pick<PageConnection, 'named' | 'pending'>): FrameV1 {
  const { named } = connection;
  return {
    tab: { title: TITLE, icon: 'box' },
    path: named === undefined ? [PLUGIN_NAME, TITLE] : [PLUGIN_NAME, named, TITLE],
    scope: [connectionFace(connection)],
  };
}

const COLUMNS: ReadonlyArray<DataTableColumn<ConnectionItem>> = [
  {
    id: 'name',
    header: 'Name',
    fit: 'flex',
    width: 160,
    text: (row) => row.name,
    cell: (row) =>
      row.logs === undefined ? (
        <Text>{row.name}</Text>
      ) : (
        <Button variant="ghost" size="row" onClick={row.logs}>
          {row.name}
        </Button>
      ),
    sortKey: (row) => row.name,
  },
  { id: 'connection', header: 'Connection', fit: 'fixed', width: 140, cell: (row) => <Text tone="muted">{row.connection}</Text>, sortKey: (row) => row.connection },
];

const refreshNothing = async (): Promise<void> => undefined;

function useItems({ plugin, route, panel }: ContextV1): ListPageViewV1<ConnectionItem> {
  const connection = useChosenConnection(plugin, route.connection);
  const { named, pending } = connection;
  const source = useMemo<ListSource<ConnectionItem>>(
    () =>
      named === undefined
        ? { state: pending ? { kind: 'loading' } : { kind: 'failed', message: 'No connections' }, rows: [], complete: false, refreshing: false, refresh: refreshNothing }
        : { state: { kind: 'ready' }, rows: itemsOf(named, panel), complete: true, refreshing: false, refresh: refreshNothing },
    [named, pending, panel],
  );
  return { frame: itemsFrame(connection), source };
}

export const connectionItemsPage = {
  kind: 'list',
  definition: {
    title: TITLE,
    nouns: { one: 'Item', other: 'Items' },
    columns: COLUMNS,
    lines: 1,
    getRowKey: (row) => row.id,
    searchText: (row) => `${row.name} ${row.connection}`.toLowerCase(),
  },
  usePage: useItems,
} satisfies ListPageV1<ConnectionItem>;
