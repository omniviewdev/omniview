import { Text, useTheme, type DataTableColumn } from '@omniviewdev/kit';
import { useConnections } from '@omniviewdev/runtime/ui/v1';
import { useMemo, useState } from 'react';
import type { ContextV1, ListPageV1, ListPageViewV1, ListSource } from '../../contract/v1';
import { ItemLink } from './detail';
import styles from './fixture.module.css';
import { ITEMS, type Item } from './items';
import { laneOf } from './lane';

// The fixture's list pages. A plugin written the way a real one is: React, the kit and the runtime's curated entry from the host, its own CSS Module, its data hook in the page.
// `items` lists the five items (items.ts), the name of each a link to its detail page (detail.tsx); its Theme column is the proof of one kit: `useTheme()` throws unless the plugin's kit
// is the one the host mounted its provider in. Its Connections column is the proof of one runtime: `useConnections()` reads through the host's QueryClient and asks the real host over its
// Wails runtime. `crash` throws from its data hook, which is how the host's containment of a failing contribution is shown. The Name and Group columns declare their sort keys and `items` says it opens
// on Name, ascending (K3a): the five items are NOT in the order of either column, so the check can tell a sorted list from one left as it was, and the two items of one group tie in the order the source gave them.

/** The theme the host's provider holds, read through the plugin's kit: it throws when that is a second copy of the kit. */
function ThemeCell() {
  const { activeTheme } = useTheme();
  return (
    <span className={styles.theme} data-fixture="theme">
      <Text>{activeTheme.name}</Text>
    </span>
  );
}

/**
 * The connections the host lists for this plugin, read through the runtime's curated entry the host shares: a real call to the real host. The fixture has no
 * backend, so the host's answer is an empty list; what it proves is the path: the shared hook, the host's QueryClient and activity provider above it, the
 * Wails runtime, the Go host and back. The text is `reading` until the answer arrives.
 */
function ConnectionsCell() {
  const { connections } = useConnections({ plugin: 'fixture-a-ok' });
  return (
    <span data-fixture="connections">
      <Text>{connections.isSuccess ? `${String(connections.data.length)} connections` : 'reading'}</Text>
    </span>
  );
}

const COLUMNS: ReadonlyArray<DataTableColumn<Item>> = [
  { id: 'name', header: 'Name', fit: 'flex', width: 160, text: (row) => row.name, cell: (row) => <ItemLink name={row.name} group={row.group} />, sortKey: (row) => row.name },
  { id: 'group', header: 'Group', fit: 'fixed', width: 96, cell: (row) => <Text tone="muted">{row.group}</Text>, sortKey: (row) => row.group },
  { id: 'opens', header: 'Opens as', fit: 'fixed', width: 96, cell: (row) => <Text tone="muted">{row.opens}</Text> },
  { id: 'theme', header: 'Theme', fit: 'fixed', width: 120, cell: () => <ThemeCell /> },
  { id: 'connections', header: 'Connections', fit: 'fixed', width: 140, cell: () => <ConnectionsCell /> },
];

const itemsFrame = (context: ContextV1): ListPageViewV1<Item>['frame'] => ({
  tab: { title: 'Items', icon: 'box' },
  path: ['Seam Fixture', 'Items'],
  scope: laneOf(context.route.connection),
});

/** The data hook of the page: React state, in the plugin, running in the host's React. */
function useItems(context: ContextV1): ListPageViewV1<Item> {
  const [refreshes, setRefreshes] = useState(0);
  const source = useMemo<ListSource<Item>>(
    () => ({
      state: { kind: 'ready' },
      rows: ITEMS,
      complete: true,
      refreshing: false,
      refresh: async () => {
        setRefreshes((count) => count + 1);
      },
    }),
    // Reading the counter makes a Refresh a new source, as a real read would be.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [refreshes],
  );
  return { frame: itemsFrame(context), source };
}

export const itemsPage = {
  kind: 'list',
  definition: {
    title: 'Items',
    nouns: { one: 'Item', other: 'Items' },
    columns: COLUMNS,
    lines: 1,
    defaultSort: { column: 'name', direction: 'ascending' },
    getRowKey: (row) => row.id,
    searchText: (row) => `${row.name} ${row.group} ${row.opens}`.toLowerCase(),
  },
  usePage: useItems,
} satisfies ListPageV1<Item>;

function useCrash(): ListPageViewV1<Item> {
  throw new Error('The fixture page crashed on purpose');
}

export const crashPage = {
  kind: 'list',
  definition: { title: 'Crash', nouns: { one: 'Crash', other: 'Crashes' }, columns: COLUMNS, lines: 1, getRowKey: (row) => row.id, searchText: (row) => row.name },
  usePage: useCrash,
} satisfies ListPageV1<Item>;
