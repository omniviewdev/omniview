// The fixtures of the table parity probe (packages/kit/probes/table-probe.mjs): the data and the columns of the design mock's own list
// tables (`mock-table-measure.mjs`: the `line-*` cases, the two-line list, `cell-identity` and `cell-identifier`), written as a consumer
// writes them. Their column widths are the widths the mock's own fit measured, in its own fonts (Inter: the widths the plan names for its first list); the probe gives
// each table the container width the mock's table had. The names here are the mock's in what the widths follow (the end of a name that
// is cut, the length of a name that clips), not in what they name. The `data-part` attributes name the pieces of a cell the probe
// compares with the mock's (a tile, a cut name, a value and its command): the probe finds a piece by that name, not by its class. The
// tile, the middle-cut name and the state are the kit's own parts (`KindTile`, `MiddleEllipsis`, `Status`), so the table is compared with
// the cells it will hold.
import { DataTable, IconButton, KindTile, MiddleEllipsis, Status, type DataTableColumn, type DataTableSort, type StatusRole } from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './DataTable.parity.module.css';

type Service = {
  readonly key: string;
  readonly name: string;
  readonly state: string;
  readonly role: StatusRole;
  readonly requests: number;
  readonly requestsText: string;
  readonly age: string;
};

// The mock's `line` fixture: twelve services, in the order it lists them (which is name order).
const service = (name: string, state: string, role: StatusRole, requests: number, age: string): Service => ({
  key: name,
  name,
  state,
  role,
  requests,
  requestsText: requests.toLocaleString('en-US'),
  age,
});
const SERVICES: readonly Service[] = [
  service('api-gateway', 'Running', 'healthy', 12, '3d'),
  service('auth-service', 'Running', 'healthy', 1204, '17h'),
  service('billing-worker', 'Pending', 'progress', 87, '5m'),
  service('cache-primary', 'Running', 'healthy', 309, '12d'),
  service('cart-api', 'Failed', 'error', 5, '2h'),
  service('checkout-web', 'Running', 'healthy', 48_112, '45s'),
  service('edge-proxy', 'Degraded', 'attention', 730, '9d'),
  service('ingest-queue', 'Running', 'healthy', 2016, '1d'),
  service('mailer', 'Stopped', 'stopped', 64, '6d'),
  service('search-index', 'Running', 'healthy', 9, '21h'),
  service('session-store', 'Running', 'healthy', 418, '33m'),
  service('web-frontend', 'Unknown', 'info', 1000, '8d'),
];
const getServiceKey = (row: Service) => row.key;

const State = ({ row }: { readonly row: Service }) => <Status role={row.role}>{row.state}</Status>;

const nameColumn: DataTableColumn<Service> = { id: 'name', header: 'Name', fit: 'id', sortKey: (row) => row.name, text: (row) => row.name, cell: (row) => row.name };
const stateColumn: DataTableColumn<Service> = { id: 'state', header: 'Status', fit: 'fixed', width: 101, sortKey: (row) => row.state, cell: (row) => <State row={row} /> };
const requestsColumn: DataTableColumn<Service> = { id: 'requests', header: 'Requests', fit: 'fixed', width: 78, align: 'end', sortKey: (row) => row.requests, sortKind: 'number', cell: (row) => row.requestsText };
const ageColumn: DataTableColumn<Service> = { id: 'age', header: 'Age', fit: 'fixed', width: 50, cell: (row) => row.age };
const lineColumns: ReadonlyArray<DataTableColumn<Service>> = [nameColumn, stateColumn, requestsColumn, ageColumn];
const inspectColumn: DataTableColumn<Service> = {
  id: 'inspect',
  header: 'Inspect',
  fit: 'fixed',
  width: 46,
  hideHeader: true,
  cell: (row) => <IconButton icon="search" label={`Inspect ${row.name}`} variant="ghost" size="row" data-part="command" />,
};
// With a command after it the age is not the last column: it has no 12 px edge to pay for, and the mock's fit measured it at 48.
const inspectColumns: ReadonlyArray<DataTableColumn<Service>> = [nameColumn, stateColumn, requestsColumn, { ...ageColumn, width: 48 }, inspectColumn];
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
  return <DataTable label="Services" rows={SERVICES} getRowKey={getServiceKey} columns={inspectColumns} sort={sort} onSortChange={setSort} onRowActivate={() => undefined} />;
};

/** The same list in a region that scrolls at 160 px: the header stays at its top. */
export const LineBounded = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>(NAME_ASCENDING);
  return <DataTable label="Services" rows={SERVICES} getRowKey={getServiceKey} columns={lineColumns} sort={sort} onSortChange={setSort} onRowActivate={() => undefined} maxHeight={160} />;
};

type Workload = {
  readonly key: string;
  readonly name: string;
  /** The characters kept whole at the end of the name when it is cut. */
  readonly tail: number;
  readonly group: string;
  readonly ready: string;
  readonly state: string;
  readonly role: StatusRole;
  readonly restarts: number;
  readonly age: string;
  readonly seconds: number;
};

/** The tail the mock keeps by default: a third of the name, 6 to 12 characters; a name of 12 or fewer is not cut. */
const tailOf = (name: string) => (name.length > 12 ? Math.min(name.length - 1, Math.min(12, Math.max(6, Math.floor(name.length / 3)))) : 0);

/** The name of a workload: a link, so in the link colour, cut in the middle when it does not fit (the kit's part keeps its end whole). */
function Name({ name, tail }: { readonly name: string; readonly tail: number }) {
  return (
    <span className={styles.name} data-part="name">
      <MiddleEllipsis tail={tail === 0 ? undefined : tail} data-part="cut">{name}</MiddleEllipsis>
    </span>
  );
}

function Identity({ row }: { readonly row: Workload }) {
  return (
    <div className={styles.identity} data-part="identity">
      <KindTile icon="box" tone="blue" data-part="tile" />
      <div className={styles.lines} data-part="lines">
        <Name name={row.name} tail={row.tail} />
        <small className={styles.group} data-part="group">{row.group}</small>
      </div>
    </div>
  );
}

// The mock's two-line list draws a running item with the play glyph (the role `running`) and the line fixture a healthy one with the check.
const STATES: ReadonlyArray<readonly [string, StatusRole]> = [
  ['Running', 'running'],
  ['Running', 'running'],
  ['Pending', 'progress'],
  ['Running', 'running'],
  ['Failed', 'error'],
  ['Running', 'running'],
];
const GROUPS = ['checkout', 'monitoring', 'storage', 'ingress', 'batch'];
const AGES: ReadonlyArray<readonly [string, number]> = [['17d', 1_468_800], ['3h', 10_800], ['45s', 45], ['9d', 777_600], ['2m', 120], ['1d', 86_400], ['6d', 518_400], ['21h', 75_600]];

const workload = (name: string, tail: number, group: string, index: number): Workload => {
  const [state, role] = STATES[index % STATES.length] ?? ['Running', 'running'];
  const [age, seconds] = AGES[index % AGES.length] ?? ['1d', 86_400];
  return { key: `${group}/${name}`, name, tail, group, ready: index % 7 === 0 ? '0/1' : '2/2', state, role, restarts: index % 11 === 0 ? 3 : 0, age, seconds };
};

/** 89 two-line workloads: the first is the one a sorted list opens with (it keeps two characters whole), the rest are spread over the groups. */
const WORKLOADS: readonly Workload[] = Array.from({ length: 89 }, (_row, index) =>
  index === 0
    ? workload('alertmanager-prom-alertmanager-0', 2, 'monitoring', index)
    : workload(`workload-${String(index).padStart(2, '0')}-${((index * 7919) % 100_000).toString(36)}-${(index % 36).toString(36)}q2z-0`, 12, GROUPS[index % GROUPS.length] ?? 'batch', index),
);
const getWorkloadKey = (row: Workload) => row.key;

const nameOfWorkload: DataTableColumn<Workload> = {
  id: 'name',
  header: 'Name',
  fit: 'id',
  lead: 28,
  sortKey: (row) => row.name,
  text: (row) => [{ text: row.name }, { text: row.group, font: 'small' }],
  keepEnd: (row) => row.tail,
  cell: (row) => <Identity row={row} />,
};
const inspectWorkload = (width: number): DataTableColumn<Workload> => ({
  id: 'inspect',
  header: 'Inspect',
  fit: 'fixed',
  width,
  hideHeader: true,
  cell: (row) => <IconButton icon="search" label={`Inspect ${row.name}`} variant="ghost" size="row" data-part="command" />,
});
// The widths the mock's fit measured for this list: the inspect column is 46 px at comfortable density and 44 at compact (a 24 and a 22 px
// target between the cell insets), so the compact density has a list of its own.
const workloadColumns = (inspectWidth: number): ReadonlyArray<DataTableColumn<Workload>> => [
  nameOfWorkload,
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 59, align: 'end', sortKey: (row) => row.ready, cell: (row) => <span className={styles.mono}>{row.ready}</span> },
  {
    id: 'state',
    header: 'Status',
    fit: 'fixed',
    width: 157,
    sortKey: (row) => row.state,
    cell: (row) => <Status role={row.role}>{row.state}</Status>,
  },
  { id: 'restarts', header: 'Restarts', fit: 'fixed', width: 72, align: 'end', sortKey: (row) => row.restarts, sortKind: 'number', cell: (row) => <span className={styles.mono}>{row.restarts}</span> },
  { id: 'age', header: 'Age', fit: 'fixed', width: 59, sortKey: (row) => row.seconds, sortKind: 'number', cell: (row) => row.age },
  inspectWorkload(inspectWidth),
];
const COMFORTABLE_COLUMNS = workloadColumns(46);
const COMPACT_COLUMNS = workloadColumns(44);

function WorkloadList({ columns }: { readonly columns: ReadonlyArray<DataTableColumn<Workload>> }) {
  const [sort, setSort] = useState<DataTableSort | undefined>(NAME_ASCENDING);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const all = selected.size === 0 ? false : selected.size === WORKLOADS.length ? true : 'mixed';
  return (
    <DataTable
      label="Workloads"
      rows={WORKLOADS}
      getRowKey={getWorkloadKey}
      columns={columns}
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
        all: {
          state: all,
          label: `Select all ${WORKLOADS.length} rows`,
          onToggle: () => {
            setSelected(all === true ? new Set() : new Set(WORKLOADS.map(getWorkloadKey)));
          },
        },
      }}
    />
  );
}

/** A list of 89 rows with an identity of two lines (40 px rows), its selection column and a command in each row. */
export const TwoLineList = () => <WorkloadList columns={COMFORTABLE_COLUMNS} />;

/** The same list for the compact density (38 px rows): its inspect column is two pixels narrower. */
export const TwoLineListCompact = () => <WorkloadList columns={COMPACT_COLUMNS} />;

// The mock's `cell-identity` and `cell-identifier` cases: the identity column held at 268 px, so that what clips is the table's to decide.
const NAMES: ReadonlyArray<readonly [string, string]> = [
  ['cart-api-7d8c6f49b-f8q4m', 'checkout'],
  ['alertmanager-prom-alertmanager-0', 'monitoring'],
  ['prometheus-stack-operator-5c9d7b8f6d-x7k2p', 'monitoring'],
  ['etcd-0', 'system'],
];
// The mock's held tables show the same ready count and the same age in every row.
const held = (row: Workload): Workload => ({ ...row, ready: '2/2', age: '17d' });
const NAMED: readonly Workload[] = NAMES.map(([name, group], index) => held(workload(name, tailOf(name), group, index)));
const heldColumns = (first: DataTableColumn<Workload>): ReadonlyArray<DataTableColumn<Workload>> => [
  first,
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 59, align: 'end', cell: (row) => <span className={styles.mono}>{row.ready}</span> },
  { id: 'age', header: 'Age', fit: 'fixed', width: 47, cell: (row) => row.age },
];
const identityColumns = heldColumns({ ...nameOfWorkload, sortKey: undefined });

/** The name of a row is cut in the middle: the start clips with an ellipsis, the end stays whole. The identity column is 268 px. */
export const IdentityCell = () => <DataTable label="Names" rows={NAMED} getRowKey={getWorkloadKey} columns={identityColumns} lines={2} onRowActivate={() => undefined} />;

const IDENTIFIERS: readonly string[] = [
  'cart-api-7d8c6f49b-f8q4m',
  'urn:example:eu-west-1:123456789012:cluster/prod-eu',
  'urn:example:iam::123456789012:role/service-role/ExampleClusterRole-prod-eu-eu-west-1',
  'i-0abc123',
];
const IDENTIFIED: readonly Workload[] = IDENTIFIERS.map((name, index) => held(workload(name, 0, '', index)));
const identifierColumns = heldColumns({
  id: 'name',
  header: 'Identifier',
  fit: 'id',
  trail: 28,
  text: (row) => row.name,
  cell: (row) => (
    <span className={styles.identifier} data-part="identifier">
      <span className={styles.identifierText} data-part="identifierText">{row.name}</span>
      <IconButton icon="copy" label="Copy identifier" variant="ghost" size="row" data-part="command" />
    </span>
  ),
});

/** A value in the code face with a command to copy it, in a column of 268 px: the value clips at the cell and the command stays. */
export const IdentifierCell = () => <DataTable label="Identifiers" rows={IDENTIFIED} getRowKey={getWorkloadKey} columns={identifierColumns} onRowActivate={() => undefined} />;

type Container = {
  readonly name: string;
  readonly image: string;
  readonly note: string;
  readonly ready: string;
  readonly restarts: string;
  readonly total: string;
};

// The mock's `cell-text` case: counts and a ready ratio in a numeric column, and text that is longer than its column.
const CONTAINERS: readonly Container[] = [
  { name: 'payments-api', image: 'registry.example.com/payments/payments-api:2026.11.3-build.8841-linux-arm64', note: 'ok', ready: '2/2', restarts: '0', total: '1,204,331' },
  { name: 'a-deployment-with-a-rather-long-name-that-has-to-be-cut', image: 'busybox:1.36', note: 'a text that is longer than its column and is cut at the cell edge with an ellipsis', ready: '10/10', restarts: '12', total: '7' },
  { name: 'mailer', image: 'ghcr.io/example/mailer@sha256:6f4a2d9c0b7e1a3f5d8c2e4b6a9d1f3c5e7a9b1d3f5a7c9e1b3d5f7a9c1e3b5d', note: 'ok', ready: '1/1', restarts: '3', total: '42' },
];
const getContainerKey = (row: Container) => row.name;
const containerColumns: ReadonlyArray<DataTableColumn<Container>> = [
  { id: 'name', header: 'Name', fit: 'id', text: (row) => row.name, cell: (row) => row.name },
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 59, align: 'end', cell: (row) => <span className={styles.mono}>{row.ready}</span> },
  { id: 'restarts', header: 'Restarts', fit: 'fixed', width: 72, align: 'end', cell: (row) => row.restarts },
  { id: 'total', header: 'Total', fit: 'fixed', width: 87, align: 'end', cell: (row) => row.total },
  { id: 'image', header: 'Image', fit: 'flex', text: (row) => row.image, cell: (row) => row.image },
  { id: 'note', header: 'Note', fit: 'flex', text: (row) => row.note, cell: (row) => row.note },
];

/** Text columns that share what the numbers leave: each takes its text, and a text that does not fit is cut at the cell edge with an ellipsis. */
export const TextCells = () => <DataTable label="Cells" rows={CONTAINERS} getRowKey={getContainerKey} columns={containerColumns} onRowActivate={() => undefined} />;
