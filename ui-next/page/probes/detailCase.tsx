import { Link, LinkProvider, type DataTableColumn, type LinkHandler } from '@omniviewdev/kit';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { DetailPage, type DetailPageDefinition, type DetailSource, type DetailTableSection, type DetailView } from '..';
import type { ShellRegistration } from '../../shell';
import { StaticShell, staticTabs } from '../../shell/testing';

// The detail page with invented data, for the probe (detail-probe.mjs): the real `Shell` in its document layout around the real `DetailPage`, with the structure and the counts of the
// design mock's page-kit detail composition (the header with its four commands and four facts, five in-page tabs one with a count, the status line, a Details list of eight pairs in
// two columns, two tables, a section with a count and an action, and an aside of labels). The words are neutral; the case is chosen by the URL: `?case=detail&state=loading|ready`.

type Part = { readonly name: string; readonly source: string; readonly ports: string; readonly needs: string; readonly limits: string };
type Member = { readonly name: string; readonly state: string; readonly ready: string; readonly restarts: number; readonly place: string; readonly age: string };

const PARTS: readonly Part[] = [
  { name: 'orders-api', source: 'registry.example.io/orders/orders-api:2.4.1', ports: '8080', needs: '250m · 256 MiB', limits: '1 · 512 MiB' },
  { name: 'proxy', source: 'example/proxy:v1.29.2', ports: '9901', needs: '100m · 128 MiB', limits: '500m · 256 MiB' },
];
const MEMBERS: readonly Member[] = [
  { name: 'orders-api-7d8c6f49b-f8q4m', state: 'Running', ready: '2/2', restarts: 0, place: 'node-10-0-32-55', age: '3d' },
  { name: 'orders-api-7d8c6f49b-hx2tz', state: 'Running', ready: '2/2', restarts: 0, place: 'node-10-0-32-55', age: '3d' },
  { name: 'orders-api-7d8c6f49b-w9k5d', state: 'Running', ready: '2/2', restarts: 1, place: 'node-10-0-41-17', age: '3d' },
];
type Condition = readonly [string, string, string, string];
const CONDITIONS: readonly Condition[] = [
  ['Available', 'True', 'MinimumReplicasAvailable', '3d ago'],
  ['Progressing', 'True', 'NewReplicaSetAvailable', '3d ago'],
];

const partColumns: ReadonlyArray<DataTableColumn<Part>> = [
  { id: 'name', header: 'Part', fit: 'id', text: (row) => row.name, cell: (row) => row.name },
  { id: 'source', header: 'Source', fit: 'flex', text: (row) => row.source, cell: (row) => row.source },
  { id: 'ports', header: 'Ports', fit: 'fixed', width: 60, align: 'end', cell: (row) => row.ports },
  { id: 'needs', header: 'Needs', fit: 'fixed', width: 128, cell: (row) => row.needs },
  { id: 'limits', header: 'Limits', fit: 'fixed', width: 128, cell: (row) => row.limits },
];
const memberColumns: ReadonlyArray<DataTableColumn<Member>> = [
  { id: 'name', header: 'Name', fit: 'id', text: (row) => row.name, cell: (row) => <Link to={{ page: 'item', params: { name: row.name } }}>{row.name}</Link> },
  { id: 'state', header: 'State', fit: 'fixed', width: 120, cell: (row) => row.state },
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 64, align: 'end', cell: (row) => row.ready },
  { id: 'restarts', header: 'Restarts', fit: 'fixed', width: 72, align: 'end', cell: (row) => String(row.restarts) },
  { id: 'place', header: 'Place', fit: 'flex', text: (row) => row.place, cell: (row) => row.place },
  { id: 'age', header: 'Age', fit: 'fixed', width: 56, align: 'end', cell: (row) => row.age },
];
const conditionColumns: ReadonlyArray<DataTableColumn<Condition>> = [
  { id: 'type', header: 'Type', fit: 'id', text: (row) => row[0], cell: (row) => row[0] },
  { id: 'status', header: 'Status', fit: 'fixed', width: 96, cell: (row) => row[1] },
  { id: 'reason', header: 'Reason', fit: 'flex', text: (row) => row[2], cell: (row) => row[2] },
  { id: 'updated', header: 'Updated', fit: 'fixed', width: 80, align: 'end', cell: (row) => row[3] },
];

const definition: DetailPageDefinition = {
  kind: 'Item',
  tile: { icon: 'layers', tone: 'blue' },
  identity: { name: 'name' },
  list: { page: 'items', label: 'Items' },
  tabs: [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'events', label: 'Events' },
    { id: 'usage', label: 'Usage' },
    { id: 'source', label: 'Source' },
  ],
};

const noop = () => undefined;

const view: DetailView = {
  state: { role: 'healthy', label: 'Available' },
  facts: [{ text: 'Item' }, { text: 'north-yard' }, { text: '3d' }, { text: '8f2a1c9e', mono: true, copy: { label: 'identifier', onCopy: noop } }],
  commands: {
    primary: { id: 'scale', label: 'Scale', icon: 'layers', onSelect: noop },
    secondary: [
      { id: 'restart', label: 'Restart', icon: 'refresh', onSelect: noop },
      { id: 'edit', label: 'Edit source', onSelect: noop },
    ],
    danger: { id: 'delete', label: 'Delete', onSelect: noop },
    menu: [
      { id: 'pause', label: 'Pause', onSelect: noop },
      { id: 'copy', label: 'Copy name', onSelect: noop },
    ],
  },
  counts: { members: 3 },
  tabs: {
    overview: {
      kind: 'overview',
      summary: [{ status: { role: 'healthy', label: 'Available' } }, { value: '3/3', label: 'ready' }, { text: 'up to date' }, { text: 'last rollout 3 days ago' }],
      sections: [
        {
          id: 'details',
          kind: 'kv',
          title: 'Details',
          priority: 10,
          columns: 2,
          rows: [
            { label: 'Group', value: <Link to={{ page: 'items' }}>north-yard</Link> },
            { label: 'Created', value: '2026-11-13 09:41 UTC · 3 days ago' },
            { label: 'Strategy', value: 'RollingUpdate · surge 25% · unavailable 25%' },
            { label: 'Revision', value: '14' },
            { label: 'Replicas', value: '3 desired · 3 ready · 3 up to date' },
            { label: 'History limit', value: '10 revisions' },
            { label: 'Selector', value: 'app=orders-api,tier=backend', mono: true },
            { label: 'Owner' },
          ],
        },
        { id: 'parts', kind: 'table', title: 'Parts', priority: 20, columns: partColumns, rows: PARTS, getRowKey: (row) => row.name } satisfies DetailTableSection<Part>,
        {
          id: 'members',
          kind: 'table',
          title: 'Members',
          count: 3,
          priority: 30,
          action: { label: 'View all', onSelect: noop },
          columns: memberColumns,
          rows: MEMBERS,
          getRowKey: (row) => row.name,
        } satisfies DetailTableSection<Member>,
        { id: 'conditions', kind: 'table', title: 'Conditions', priority: 40, columns: conditionColumns, rows: CONDITIONS, getRowKey: (row) => row[0] } satisfies DetailTableSection<Condition>,
        {
          id: 'labels',
          kind: 'tags',
          title: 'Labels',
          placement: 'aside',
          items: [
            { key: 'app', value: 'orders-api' },
            { key: 'tier', value: 'backend' },
            { key: 'example.io/managed-by', value: 'helm' },
          ],
        },
      ],
    },
  },
};

const handler: LinkHandler = { hrefOf: () => '#', onOpen: noop };
const tabs = staticTabs([{ title: 'orders-api · Item', icon: 'layers', path: ['Acme', 'north', 'Items', 'orders-api'] }]);
const registration: ShellRegistration = {
  plugin: { name: 'Acme' },
  rail: true,
  layout: 'document',
  sidebar: { label: 'Acme resources', title: 'Resources', nodes: [{ id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'entry', label: 'Items', icon: 'box' }] }], open: ['group'], current: 'entry', accent: 'blue' },
  scope: [
    { label: 'Connection', icon: 'server', text: 'north' },
    { label: 'Scope', icon: 'folder-tree', text: 'Everything' },
  ],
};
const path = [{ label: 'Acme', onSelect: noop }, { label: 'north' }, { label: 'Items', onSelect: noop }, { label: 'orders-api' }] as const;

/** `?case=detail&state=ready` (default) or `loading` until the probe lets the object arrive (`window.__fixture.ready()`). */
export function DetailCase({ start, expose }: { readonly start: 'ready' | 'loading'; readonly expose: (ready: () => void) => void }) {
  const [loaded, setLoaded] = useState(start === 'ready');
  useEffect(() => {
    expose(() => {
      flushSync(() => {
        setLoaded(true);
      });
    });
  }, [expose]);

  const source: DetailSource = { state: loaded ? { kind: 'ready' } : { kind: 'loading' }, view: loaded ? view : undefined, refreshing: false, refresh: async () => undefined };
  return (
    <LinkProvider handler={handler}>
      <StaticShell registration={registration} tabs={tabs}>
        <DetailPage definition={definition} params={{ name: 'orders-api' }} source={source} path={path} />
      </StaticShell>
    </LinkProvider>
  );
}
