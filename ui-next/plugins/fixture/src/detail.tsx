import { Icon, Link, MiddleEllipsis, Text, type DataTableColumn, type KeyValueRow } from '@omniviewdev/kit';
import { useEffect, useState } from 'react';
import type { ContextV1, DetailPageV1, DetailPageViewV1, DetailSection, DetailSource, DetailTableSection, DetailView, PanelHostV1 } from '../../contract/v1';
import styles from './fixture.module.css';
import { modeOf, READ_MS } from './items';
import { logCommandsOf } from './logs';

// The fixture's detail page: one item, read by a hook that answers the state each item is built to be in (items.ts): loading for ever, not found, denied, an error that a Retry
// clears, and ready. The page's own words are the plugin's here; the host draws them. A ready item is a whole Overview made of the sections the contract has: a Details list, two tables,
// a list of recent warnings and a set of labels, and one section that has nothing to say and so is not drawn. Its commands report to callbacks the page can be seen to have heard:
// Scale changes the replica count in Details, Delete makes the item not found, and four commands in the menu open the item's Logs sessions through `ctx.panel` (logs.ts).

type Part = { readonly name: string; readonly source: string; readonly ports: string; readonly needs: string; readonly limits: string };

const PARTS: readonly Part[] = [
  { name: 'orders-api', source: 'registry.example.io/orders/orders-api:2.4.1', ports: '8080', needs: '250m · 256 MiB', limits: '1 · 512 MiB' },
  { name: 'proxy', source: 'example/proxy:v1.29.2', ports: '9901', needs: '100m · 128 MiB', limits: '500m · 256 MiB' },
];

const PART_COLUMNS: ReadonlyArray<DataTableColumn<Part>> = [
  { id: 'name', header: 'Part', fit: 'id', text: (row) => row.name, cell: (row) => <b>{row.name}</b> },
  { id: 'source', header: 'Source', fit: 'flex', text: (row) => row.source, cell: (row) => <span className={styles.mono}>{row.source}</span> },
  { id: 'ports', header: 'Ports', fit: 'fixed', width: 72, align: 'end', cell: (row) => row.ports },
  { id: 'needs', header: 'Needs', fit: 'fixed', width: 128, text: (row) => row.needs, cell: (row) => row.needs },
  { id: 'limits', header: 'Limits', fit: 'fixed', width: 120, text: (row) => row.limits, cell: (row) => row.limits },
];

type Condition = readonly [type: string, status: string, reason: string, updated: string];

const CONDITIONS: readonly Condition[] = [
  ['Available', 'True', 'MinimumReplicasAvailable', '3d ago'],
  ['Progressing', 'True', 'NewReplicaSetAvailable', '3d ago'],
];

const CONDITION_COLUMNS: ReadonlyArray<DataTableColumn<Condition>> = [
  { id: 'type', header: 'Type', fit: 'id', text: (row) => row[0], cell: (row) => row[0] },
  { id: 'status', header: 'Status', fit: 'fixed', width: 96, cell: (row) => row[1] },
  { id: 'reason', header: 'Reason', fit: 'flex', text: (row) => row[2], cell: (row) => row[2] },
  { id: 'updated', header: 'Updated', fit: 'fixed', width: 88, align: 'end', cell: (row) => row[3] },
];

const LABELS = [
  { key: 'app', value: 'orders-api' },
  { key: 'tier', value: 'backend' },
  { key: 'example.io/managed-by', value: 'helm' },
  { key: 'region', value: 'north' },
  { key: 'track', value: 'stable' },
  { key: 'team', value: 'payments' },
  { key: 'cost-centre', value: '4410' },
  { key: 'example.io/chart', value: 'orders-api-1.9.0' },
  { key: 'example.io/revision', value: '14' },
] as const;

type Controls = {
  readonly replicas: number;
  readonly reads: number;
  readonly scale: () => void;
  readonly remove: () => void;
  readonly panel: PanelHostV1 | undefined;
};

function sectionsOf(group: string, { replicas, reads }: Controls): readonly DetailSection[] {
  const details: readonly KeyValueRow[] = [
    { label: 'Group', value: <Link to={{ page: 'items' }}>{group}</Link> },
    { label: 'Created', value: '2026-11-13 09:41 UTC · 3 days ago' },
    { label: 'Strategy', value: 'RollingUpdate · surge 25% · unavailable 25%' },
    { label: 'Revision', value: '14' },
    { label: 'Replicas', value: `${String(replicas)} desired · ${String(replicas)} ready · ${String(replicas)} up to date` },
    { label: 'Reads', value: String(reads) },
    { label: 'Selector', value: 'app=orders-api,tier=backend', mono: true },
    { label: 'Owner' },
  ];
  const parts = {
    id: 'parts',
    kind: 'table',
    title: 'Parts',
    count: PARTS.length,
    priority: 20,
    columns: PART_COLUMNS,
    rows: PARTS,
    getRowKey: (row) => row.name,
  } satisfies DetailTableSection<Part>;
  const conditions = {
    id: 'conditions',
    kind: 'table',
    title: 'Conditions',
    priority: 30,
    columns: CONDITION_COLUMNS,
    rows: CONDITIONS,
    getRowKey: (row) => row[0],
  } satisfies DetailTableSection<Condition>;
  return [
    { id: 'details', kind: 'kv', title: 'Details', priority: 10, columns: 2, rows: details },
    parts,
    conditions,
    // Nothing to say: the page does not draw it (no empty heading, no placeholder).
    { id: 'budget', kind: 'kv', title: 'Budget', priority: 40, rows: [] },
    {
      id: 'warnings',
      kind: 'list',
      title: 'Recent warnings',
      placement: 'aside',
      priority: 20,
      rows: [
        { id: 'w1', icon: <Icon name="status-warning" />, title: 'Readiness check failed', detail: 'Part proxy: the health endpoint answered 503', meta: '2h' },
        { id: 'w2', icon: <Icon name="status-warning" />, title: 'Restarted', detail: 'Part orders-api was restarted after a failed liveness check', meta: '3d' },
      ],
    },
    { id: 'labels', kind: 'tags', title: 'Labels', placement: 'aside', priority: 30, items: LABELS },
  ];
}

function viewOf(name: string, group: string, controls: Controls): DetailView {
  return {
    state: { role: 'running', label: 'Running' },
    facts: [{ text: 'Item' }, { text: group }, { text: '3d' }, { text: 'a1b2c3d4', mono: true, copy: { label: 'identifier', onCopy: () => undefined } }],
    commands: {
      primary: { id: 'scale', label: 'Scale', icon: 'layers', onSelect: controls.scale },
      secondary: [
        { id: 'restart', label: 'Restart', icon: 'refresh', onSelect: () => undefined },
        { id: 'edit', label: 'Edit', onSelect: () => undefined },
      ],
      danger: { id: 'delete', label: 'Delete', onSelect: controls.remove },
      menu: [{ id: 'copy', label: 'Copy name', onSelect: () => undefined }, ...logCommandsOf({ name, group }, controls.panel)],
    },
    counts: { parts: PARTS.length },
    tabs: {
      overview: {
        kind: 'overview',
        summary: [{ status: { role: 'running', label: 'Running' } }, { value: `${String(controls.replicas)}/${String(controls.replicas)}`, label: 'ready' }, { text: 'up to date' }, { text: 'last change 3 days ago' }],
        sections: sectionsOf(group, controls),
      },
      parts: { kind: 'custom', content: <Text>{`The parts of ${name} are listed in the Overview.`}</Text> },
      activity: { kind: 'custom', content: <Text tone="muted">Nothing happened lately.</Text> },
    },
  };
}

/** The data hook of the detail page: React state in the plugin, running in the host's React. Each item is built to be in one state (items.ts). */
function useItem(context: ContextV1): DetailPageViewV1 {
  const name = context.route.params.name ?? '';
  const group = context.route.params.group ?? '';
  const mode = modeOf(name);
  // A Retry is a new read of an item that failed; a Refresh is a read that changes nothing but the count of reads.
  const [attempts, setAttempts] = useState(0);
  const [reads, setReads] = useState(0);
  const [doneKey, setDoneKey] = useState('');
  const [replicas, setReplicas] = useState(2);
  const [deleted, setDeleted] = useState(false);

  // The read that is over is named by what it read (the item and the attempt), so a new read is unsettled without a state write: the effect only ends a read from its timer.
  const key = `${mode}:${String(attempts)}`;
  const settled = doneKey === key;
  useEffect(() => {
    if (mode === 'loading') {
      return undefined;
    }

    const timer = setTimeout(() => {
      setDoneKey(key);
    }, READ_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [mode, key]);

  const retry = () => {
    setAttempts((count) => count + 1);
  };

  const refresh = async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, READ_MS);
    });
    setReads((count) => count + 1);
  };

  const controls: Controls = {
    replicas,
    reads,
    scale: () => {
      setReplicas((count) => count + 1);
    },
    remove: () => {
      setDeleted(true);
    },
    panel: context.panel,
  };

  const source = (state: DetailSource['state'], view: DetailView | undefined): DetailSource => ({ state, view, refreshing: false, refresh });
  const scope = [{ label: 'Connection', icon: 'server' as const, text: context.route.connection ?? 'none' }];
  if (!settled || mode === 'loading') {
    return { scope, source: source({ kind: 'loading' }, undefined) };
  }

  if (mode === 'not-found' || deleted) {
    return { scope, source: source({ kind: 'not-found' }, undefined) };
  }

  if (mode === 'denied') {
    return { scope, source: source({ kind: 'denied', message: 'Your role may not read items in this group.' }, undefined) };
  }

  if (mode === 'failing' && attempts === 0) {
    return { scope, source: source({ kind: 'failed', message: 'The read timed out.', retry }, undefined) };
  }

  return { scope, source: source({ kind: 'ready' }, viewOf(name, group, controls)) };
}

export const itemPage = {
  kind: 'detail',
  definition: {
    kind: 'Item',
    tile: { icon: 'layers', tone: 'blue' },
    identity: { name: 'name', facets: ['group'] },
    list: { page: 'items', label: 'Items' },
    tabs: [
      { id: 'overview', label: 'Overview' },
      { id: 'parts', label: 'Parts' },
      { id: 'activity', label: 'Activity' },
    ],
  },
  usePage: useItem,
} satisfies DetailPageV1;

/** The name cell of a row of the list: a link to the item's detail page, its name cut in the middle when the column is narrow. */
export function ItemLink({ name, group }: { readonly name: string; readonly group: string }) {
  return (
    <Link to={{ page: 'item', params: { name, group } }}>
      <MiddleEllipsis>{name}</MiddleEllipsis>
    </Link>
  );
}
