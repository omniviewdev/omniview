// The fixtures of the table parity probe (packages/kit/probes/table-probe.mjs): the data and the columns of the design mock's own list
// tables (`mock-table-measure.mjs`: the `line-*` cases, the two-line list, `cell-identity` and `cell-identifier`), written as a consumer
// writes them. Their column widths are the widths the mock's own fit measured in the probe's normalized font (Helvetica); the probe gives
// each table the container width the mock's table had. The names here are the mock's in what the widths follow (the end of a name that
// is cut, the length of a name that clips), not in what they name.
import { DataTable, Icon, IconButton, Stack, Text, type DataTableColumn, type DataTableSort, type IconName } from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './DataTable.parity.module.css';

type Service = {
  readonly key: string;
  readonly name: string;
  readonly state: string;
  readonly glyph: IconName;
  readonly requests: number;
  readonly requestsText: string;
  readonly age: string;
};

// The mock's `line` fixture: twelve services, in the order it lists them (which is name order).
const service = (name: string, state: string, glyph: IconName, requests: number, age: string): Service => ({
  key: name,
  name,
  state,
  glyph,
  requests,
  requestsText: requests.toLocaleString('en-US'),
  age,
});
const SERVICES: readonly Service[] = [
  service('api-gateway', 'Running', 'status-success', 12, '3d'),
  service('auth-service', 'Running', 'status-success', 1204, '17h'),
  service('billing-worker', 'Pending', 'status-warning', 87, '5m'),
  service('cache-primary', 'Running', 'status-success', 309, '12d'),
  service('cart-api', 'Failed', 'status-error', 5, '2h'),
  service('checkout-web', 'Running', 'status-success', 48_112, '45s'),
  service('edge-proxy', 'Degraded', 'status-warning', 730, '9d'),
  service('ingest-queue', 'Running', 'status-success', 2016, '1d'),
  service('mailer', 'Stopped', 'status-info', 64, '6d'),
  service('search-index', 'Running', 'status-success', 9, '21h'),
  service('session-store', 'Running', 'status-success', 418, '33m'),
  service('web-frontend', 'Unknown', 'status-info', 1000, '8d'),
];
const getServiceKey = (row: Service) => row.key;

function State({ row }: { readonly row: Service }) {
  return (
    <Stack direction="row" gap={4} align="center">
      <Icon name={row.glyph} />
      <Text>{row.state}</Text>
    </Stack>
  );
}

const nameColumn: DataTableColumn<Service> = { id: 'name', header: 'Name', fit: 'id', sortKey: (row) => row.name, text: (row) => row.name, cell: (row) => row.name };
const lineColumns: ReadonlyArray<DataTableColumn<Service>> = [
  nameColumn,
  { id: 'state', header: 'Status', fit: 'fixed', width: 98, sortKey: (row) => row.state, cell: (row) => <State row={row} /> },
  { id: 'requests', header: 'Requests', fit: 'fixed', width: 75, align: 'end', sortKey: (row) => row.requests, sortKind: 'number', cell: (row) => row.requestsText },
  { id: 'age', header: 'Age', fit: 'fixed', width: 48, cell: (row) => row.age },
];
const inspectColumn: DataTableColumn<Service> = {
  id: 'inspect',
  header: 'Inspect',
  fit: 'fixed',
  width: 46,
  cell: (row) => <IconButton icon="search" label={`Inspect ${row.name}`} variant="ghost" size="row" />,
};
const NAME_ASCENDING: DataTableSort = { column: 'name', direction: 'ascending' };

/** One-line rows: a sorted name column that takes what is left, a status, a count and an age; a click on a row does something. */
export const LinePlain = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>(NAME_ASCENDING);
  return <DataTable label="Services" rows={SERVICES} getRowKey={getServiceKey} columns={lineColumns} sort={sort} onSortChange={setSort} onRowActivate={() => undefined} />;
};

/** The same list with its selection column: two rows selected, and a select-all that reads mixed. */
export const LineSelection = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>(NAME_ASCENDING);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['auth-service', 'billing-worker']));
  const all = selected.size === 0 ? false : selected.size === SERVICES.length ? true : 'mixed';
  return (
    <DataTable
      label="Services"
      rows={SERVICES}
      getRowKey={getServiceKey}
      columns={lineColumns}
      sort={sort}
      onSortChange={setSort}
      onRowActivate={() => undefined}
      selection={{
        selected,
        label: (row) => `Select ${row.name}`,
        onToggle: (row) => {
          setSelected((current) => {
            const next = new Set(current);
            if (!next.delete(row.key)) {
              next.add(row.key);
            }

            return next;
          });
        },
        all: {
          state: all,
          label: `Select all ${SERVICES.length} rows`,
          onToggle: () => {
            setSelected(all === true ? new Set() : new Set(SERVICES.map(getServiceKey)));
          },
        },
      }}
    />
  );
};

/** The same list with a command in each row: a 24 px button in a 24 px row. */
export const LineInspect = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>(NAME_ASCENDING);
  return <DataTable label="Services" rows={SERVICES} getRowKey={getServiceKey} columns={[...lineColumns, inspectColumn]} sort={sort} onSortChange={setSort} onRowActivate={() => undefined} />;
};

/** The same list in a region that scrolls at 160 px: the header stays at its top. */
export const LineBounded = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>(NAME_ASCENDING);
  return <DataTable label="Services" rows={SERVICES} getRowKey={getServiceKey} columns={lineColumns} sort={sort} onSortChange={setSort} onRowActivate={() => undefined} maxHeight={160} />;
};

type Workload = {
  readonly key: string;
  readonly name: string;
  readonly group: string;
  readonly ready: string;
  readonly state: string;
  readonly glyph: IconName;
  readonly restarts: number;
  readonly age: string;
};

/** The name of a split name: the characters kept whole at its end, as the mock's rule keeps them (a third of the name, 6 to 12). */
const tailOf = (name: string) => (name.length > 12 ? Math.min(name.length - 1, Math.min(12, Math.max(6, Math.floor(name.length / 3)))) : 0);

function CutName({ name }: { readonly name: string }) {
  const tail = tailOf(name);
  return tail === 0 ? (
    <span>{name}</span>
  ) : (
    <span className={styles.cut}>
      <span className={styles.head}>{name.slice(0, -tail)}</span>
      <span className={styles.tail}>{name.slice(-tail)}</span>
    </span>
  );
}

function Identity({ row }: { readonly row: Workload }) {
  return (
    <div className={styles.identity}>
      <span className={styles.tile} aria-hidden="true">
        <Icon name="box" />
      </span>
      <div className={styles.lines}>
        <CutName name={row.name} />
        <small className={styles.group}>{row.group}</small>
      </div>
    </div>
  );
}

const STATES: ReadonlyArray<readonly [string, IconName]> = [
  ['Running', 'status-success'],
  ['Running', 'status-success'],
  ['Pending', 'status-warning'],
  ['Running', 'status-success'],
  ['Failed', 'status-error'],
  ['Running', 'status-success'],
];
const GROUPS = ['checkout', 'monitoring', 'storage', 'ingress', 'batch'];
const AGES = ['17d', '3h', '45s', '9d', '2m', '1d', '6d', '21h'];

/** 89 two-line workloads: the first is the one a sorted list opens with, and the rest are spread over the groups. */
const WORKLOADS: readonly Workload[] = Array.from({ length: 89 }, (_row, index) => {
  const [state, glyph] = STATES[index % STATES.length] ?? STATES[0] ?? ['Running', 'status-success'];
  const name = index === 0 ? 'alertmanager-prom-alertmanager-0' : `workload-${String(index).padStart(2, '0')}-${((index * 7919) % 100_000).toString(36)}-${(index % 36).toString(36)}q2z-0`;
  return {
    key: `${GROUPS[index % GROUPS.length] ?? 'batch'}/${name}`,
    name,
    group: GROUPS[index % GROUPS.length] ?? 'batch',
    ready: index % 7 === 0 ? '0/1' : '2/2',
    state,
    glyph,
    restarts: index % 11 === 0 ? 3 : 0,
    age: AGES[index % AGES.length] ?? '1d',
  };
});
const getWorkloadKey = (row: Workload) => row.key;

const workloadColumns: ReadonlyArray<DataTableColumn<Workload>> = [
  {
    id: 'name',
    header: 'Name',
    fit: 'id',
    lead: 28,
    sortKey: (row) => row.name,
    text: (row) => [{ text: row.name }, { text: row.group, font: 'small' }],
    keepEnd: (row) => tailOf(row.name),
    cell: (row) => <Identity row={row} />,
  },
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 58, align: 'end', sortKey: (row) => row.ready, cell: (row) => <span className={styles.mono}>{row.ready}</span> },
  {
    id: 'state',
    header: 'Status',
    fit: 'fixed',
    width: 150,
    sortKey: (row) => row.state,
    cell: (row) => (
      <Stack direction="row" gap={4} align="center">
        <Icon name={row.glyph} />
        <Text>{row.state}</Text>
      </Stack>
    ),
  },
  { id: 'restarts', header: 'Restarts', fit: 'fixed', width: 69, align: 'end', sortKey: (row) => row.restarts, sortKind: 'number', cell: (row) => <span className={styles.mono}>{row.restarts}</span> },
  { id: 'age', header: 'Age', fit: 'fixed', width: 58, cell: (row) => row.age },
  { id: 'inspect', header: 'Inspect', fit: 'fixed', width: 46, cell: (row) => <IconButton icon="search" label={`Inspect ${row.name}`} variant="ghost" size="row" /> },
];

/** A list of 89 rows with an identity of two lines (40 px rows, 38 compact), its selection column and a command in each row. */
export const TwoLineList = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>(NAME_ASCENDING);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <DataTable
      label="Workloads"
      rows={WORKLOADS}
      getRowKey={getWorkloadKey}
      columns={workloadColumns}
      lines={2}
      sort={sort}
      onSortChange={setSort}
      onRowActivate={() => undefined}
      maxHeight={446}
      selection={{
        selected,
        label: (row) => `Select ${row.group}/${row.name}`,
        onToggle: (row) => {
          setSelected((current) => {
            const next = new Set(current);
            if (!next.delete(row.key)) {
              next.add(row.key);
            }

            return next;
          });
        },
      }}
    />
  );
};

// The mock's `cell-identity` and `cell-identifier` cases: the identity column held at 268 px, so that what clips is the table's to decide.
const NAMES: ReadonlyArray<readonly [string, string]> = [
  ['cart-api-7d8c6f49b-f8q4m', 'checkout'],
  ['alertmanager-prom-alertmanager-0', 'monitoring'],
  ['prometheus-stack-operator-5c9d7b8f6d-x7k2p', 'monitoring'],
  ['etcd-0', 'system'],
];
const NAMED: readonly Workload[] = NAMES.map(([name, group], index) => ({ key: name, name, group, ready: '2/2', state: 'Running', glyph: 'status-success', restarts: 0, age: AGES[index] ?? '1d' }));
const heldColumns = (first: DataTableColumn<Workload>): ReadonlyArray<DataTableColumn<Workload>> => [
  first,
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 58, align: 'end', cell: (row) => <span className={styles.mono}>{row.ready}</span> },
  { id: 'age', header: 'Age', fit: 'fixed', width: 46, cell: (row) => row.age },
];
const identityColumns = heldColumns({ id: 'name', header: 'Name', fit: 'id', lead: 28, text: (row) => [{ text: row.name }, { text: row.group, font: 'small' }], keepEnd: (row) => tailOf(row.name), cell: (row) => <Identity row={row} /> });

/** The name of a row is cut in the middle: the start clips with an ellipsis, the end stays whole. The identity column is 268 px. */
export const IdentityCell = () => <DataTable label="Names" rows={NAMED} getRowKey={getWorkloadKey} columns={identityColumns} lines={2} />;

const IDENTIFIERS: readonly string[] = [
  'cart-api-7d8c6f49b-f8q4m',
  'urn:example:eu-west-1:123456789012:cluster/prod-eu',
  'urn:example:iam::123456789012:role/service-role/ExampleClusterRole-prod-eu-eu-west-1',
  'i-0abc123',
];
const IDENTIFIED: readonly Workload[] = IDENTIFIERS.map((name, index) => ({ key: name, name, group: '', ready: '2/2', state: 'Running', glyph: 'status-success', restarts: 0, age: AGES[index] ?? '1d' }));
const identifierColumns = heldColumns({
  id: 'name',
  header: 'Identifier',
  fit: 'id',
  trail: 28,
  text: (row) => row.name,
  cell: (row) => (
    <span className={styles.identifier}>
      <span className={styles.identifierText}>{row.name}</span>
      <IconButton icon="copy" label="Copy identifier" variant="ghost" size="row" />
    </span>
  ),
});

/** A value in the code face with a command to copy it, in a column of 268 px: the value clips at the cell and the command stays. */
export const IdentifierCell = () => <DataTable label="Identifiers" rows={IDENTIFIED} getRowKey={getWorkloadKey} columns={identifierColumns} />;
