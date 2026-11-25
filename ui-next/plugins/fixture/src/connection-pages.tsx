import { Button, Link, Text, type DataTableColumn } from '@omniviewdev/kit';
import { useMemo } from 'react';
import type { ContextV1, DetailPageViewV1, DetailSource, DetailView, FrameV1, ListPageV1, ListPageViewV1, ListSource, OverviewPageV1, PanelHostV1 } from '../../contract/v1';
import { connectionFace, useChosenConnection, type PageConnection } from './connection';
import { connectionLogTargetOf } from './logs';

// The pages of the connections fixture: a list whose three rows depend on the connection the route names, read the way a plugin with real connections reads it (connection.ts), and the overview of the connection (below). The rows are static,
// keyed by the connection's NAME: the backend (../connections-process) serves the same names (`connection.test.ts` reads its source and holds these rows, and each connection's id and description, to it), and the host starts a connection before it routes to it, so the page reads no resource. The name of a row is a button that
// opens the item's Logs session through the panel handle the host gave the page (`ContextV1.panel`, as a plugin's row action does): the proof that a session belongs to the host's panel and not to the connection the
// page was read in (decision A21: it stays when the tab goes to another connection).
//
// The overview (HM3) is the plugin's home: the page a connection lands on, with the connection's NAME as its heading. It is written the way a plugin writes one: a state and a fact in the header, a summary, and a section of each kind the Overview draws (a
// list whose rows are links to the Items page, a table of the connection's items, and the connection's own facts as key and value pairs). Its data is as static as the list's, keyed by the connection's name, and what the plugin says of the connection (its
// description) is what the runtime's `useConnections` gives.

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

/** What a check reads on `window.__fixtureOverview`: how many times the overview's own Refresh asked the plugin to read the page again (the data is static, so the call is what there is to count). */
export type FixtureOverviewCounters = { refreshes: number };

const OVERVIEW_KEY = '__fixtureOverview';

/** The counters, made on first use: the plugin and its copy share one window, and so one set. */
function overviewCounters(): FixtureOverviewCounters {
  const found: unknown = Reflect.get(window, OVERVIEW_KEY);
  if (typeof found === 'object' && found !== null) {
    return found as FixtureOverviewCounters;
  }

  const made: FixtureOverviewCounters = { refreshes: 0 };
  Reflect.set(window, OVERVIEW_KEY, made);
  return made;
}

const refreshOverview = async (): Promise<void> => {
  overviewCounters().refreshes += 1;
};

/** What needs attention in a connection, by its name: the item, why, and for how long. The rows of the overview's list, each a link to the page that lists the items. */
const ATTENTION: Readonly<Record<string, ReadonlyArray<{ readonly item: string; readonly why: string; readonly age: string }>>> = {
  north: [{ item: 'ledger-sync', why: 'Two writes are waiting', age: '4m' }],
  south: [
    { item: 'tide-table', why: 'The last sync was three hours ago', age: '3h' },
    { item: 'keel-check', why: 'Its check has not run yet', age: '12m' },
  ],
};

const OVERVIEW_TITLE = 'Overview';

/** The overview's table: the connection's items, as the list names them, with the name as text (the Logs sessions are the list's). */
const ITEM_COLUMNS: ReadonlyArray<DataTableColumn<ConnectionItem>> = [
  { id: 'name', header: 'Name', fit: 'flex', width: 160, text: (row) => row.name, cell: (row) => <Text>{row.name}</Text> },
  { id: 'connection', header: 'Connection', fit: 'fixed', width: 140, cell: (row) => <Text tone="muted">{row.connection}</Text> },
];

/** The overview of the connection called `name`, with the line its process says under the name (the SDK's `Description`): what the header, the summary and the three sections say. */
export function overviewViewOf(name: string, description: string): DetailView {
  const items = itemsOf(name);
  const attention = ATTENTION[name] ?? [];
  return {
    state: { role: 'healthy', label: 'Connected' },
    facts: description.trim() === '' ? [] : [{ text: description }],
    tabs: {
      overview: {
        kind: 'overview',
        summary: [
          { status: { role: 'healthy', label: 'Connected' } },
          { value: String(items.length), label: items.length === 1 ? 'item' : 'items' },
          { text: attention.length === 0 ? 'nothing needs attention' : `${String(attention.length)} to look at` },
        ],
        sections: [
          {
            id: 'attention',
            kind: 'list',
            title: 'Needs attention',
            count: attention.length,
            rows: attention.map(({ item, why, age }) => ({ id: item, title: <Link to={{ page: 'items' }}>{item}</Link>, detail: why, meta: age })),
          },
          { id: 'items', kind: 'table', title: 'Items', count: items.length, columns: ITEM_COLUMNS, rows: items, getRowKey: (row) => row.id },
          {
            id: 'connection',
            kind: 'kv',
            title: 'Connection',
            rows: [
              { label: 'Name', value: name },
              { label: 'Description', value: description },
              { label: 'Items', value: String(items.length) },
            ],
          },
        ],
      },
    },
  };
}

function useOverview({ plugin, route }: ContextV1): DetailPageViewV1 {
  const connection = useChosenConnection(plugin, route.connection);
  const { chosen, named, pending } = connection;
  const description = chosen?.description ?? '';
  const source = useMemo<DetailSource>(
    () =>
      named === undefined
        ? { state: pending ? { kind: 'loading' } : { kind: 'failed', message: 'No connections' }, view: undefined, refreshing: false, refresh: refreshOverview }
        : { state: { kind: 'ready' }, view: overviewViewOf(named, description), refreshing: false, refresh: refreshOverview },
    [named, pending, description],
  );
  return { scope: [connectionFace(connection)], source };
}

export const connectionOverviewPage = {
  kind: 'overview',
  definition: { title: OVERVIEW_TITLE, tile: { icon: 'server', tone: 'blue' }, tabs: [{ id: 'overview', label: 'Overview' }] },
  usePage: useOverview,
} satisfies OverviewPageV1;
