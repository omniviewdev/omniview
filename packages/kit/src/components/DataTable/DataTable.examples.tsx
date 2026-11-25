import { DataTable, Icon, IconButton, menuTrigger, useMenu, type DataTableColumn, type DataTableSort } from '@omniviewdev/kit';
import { useMemo, useState } from 'react';

type Job = { readonly key: string; readonly name: string; readonly group: string; readonly state: string; readonly attempts: number; readonly created: number };

const STATES = ['Running', 'Pending', 'Running', 'Running', 'Failed'];
const jobs = (count: number): Job[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `job-${index}`,
    name: `render-${(index * 7919) % 100_000}-x${(index % 36).toString(36)}q2z`,
    group: `team-${index % 9}`,
    state: STATES[index % STATES.length] ?? 'Running',
    attempts: index % 5 === 0 ? 0 : index % 4,
    created: 1_700_000_000_000 - index * 3_600_000,
  }));

const SMALL = jobs(12);
const LARGE = jobs(5000);
const getRowKey = (row: Job) => row.key;

// A column list keeps its identity: it is built once, outside the component.
const stateColumn: DataTableColumn<Job> = {
  id: 'state',
  header: 'State',
  fit: 'fixed',
  width: 120,
  sortKey: (row) => row.state,
  cell: (row) => (
    <>
      <Icon name={row.state === 'Running' ? 'status-success' : row.state === 'Pending' ? 'status-warning' : 'status-error'} />
      {` ${row.state}`}
    </>
  ),
};
const attemptsColumn: DataTableColumn<Job> = { id: 'attempts', header: 'Attempts', fit: 'fixed', width: 86, align: 'end', sortKey: (row) => row.attempts, sortKind: 'number', cell: (row) => String(row.attempts) };
const columns: ReadonlyArray<DataTableColumn<Job>> = [
  { id: 'name', header: 'Name', fit: 'id', sortKey: (row) => row.name, text: (row) => row.name, cell: (row) => row.name },
  { id: 'group', header: 'Group', fit: 'flex', sortKey: (row) => row.group, text: (row) => row.group, cell: (row) => row.group },
  stateColumn,
  attemptsColumn,
];

const twoLine: ReadonlyArray<DataTableColumn<Job>> = [
  {
    id: 'name',
    header: 'Name',
    fit: 'id',
    sortKey: (row) => row.name,
    text: (row) => [{ text: row.name }, { text: row.group, font: 'small' }],
    keepEnd: () => 6,
    cell: (row) => (
      <>
        <div>{row.name}</div>
        <div>{row.group}</div>
      </>
    ),
  },
  stateColumn,
  attemptsColumn,
];

/** One-line rows (24 px) sorted by name, with the sort in the header: the default list. */
export const Default = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>({ column: 'name', direction: 'ascending' });
  return <DataTable label="Jobs" rows={SMALL} getRowKey={getRowKey} columns={columns} sort={sort} onSortChange={setSort} maxHeight={320} />;
};

/** Two-line rows (40 px): an identity with a second line under it. */
export const TwoLines = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>({ column: 'name', direction: 'descending' });
  return <DataTable label="Jobs" rows={SMALL} getRowKey={getRowKey} columns={twoLine} lines={2} sort={sort} onSortChange={setSort} maxHeight={360} />;
};

/** A leading column of named checkboxes, with a select-all that reads mixed while some rows are selected. */
export const Selection = () => {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['job-1', 'job-2']));
  const all = selected.size === 0 ? false : selected.size === SMALL.length ? true : 'mixed';
  return (
    <DataTable
      label="Jobs"
      rows={SMALL}
      getRowKey={getRowKey}
      columns={columns}
      maxHeight={320}
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
        all: { state: all, label: `Select all ${SMALL.length} rows`, onToggle: () => {
          setSelected(all === true ? new Set() : new Set(SMALL.map(getRowKey))); 
        } },
      }}
    />
  );
};

/** A click on a row is the pointer's convenience: the row paints under the pointer only because a click does something. */
export const Activatable = () => {
  const [opened, setOpened] = useState('nothing');
  return (
    <>
      <DataTable label="Jobs" rows={SMALL} getRowKey={getRowKey} columns={columns} maxHeight={320} onRowActivate={(row) => {
        setOpened(row.name); 
      }} />
      <p>{`Opened ${opened}`}</p>
    </>
  );
};

/** 5,000 rows: only the rows in view are in the document, and sorting a column does not remount them. */
export const Large = () => {
  const [sort, setSort] = useState<DataTableSort | undefined>({ column: 'name', direction: 'ascending' });
  const rows = useMemo(() => LARGE, []);
  return <DataTable label="Jobs" rows={rows} getRowKey={getRowKey} columns={columns} sort={sort} onSortChange={setSort} rowsAreImmutable maxHeight={360} />;
};

/** No rows: the header stays; what to say about an empty list is the collection state's job. */
export const Empty = () => <DataTable label="Jobs" rows={[]} getRowKey={getRowKey} columns={columns} maxHeight={200} />;

/**
 * `rowMenu` makes every row a context trigger for the view's one menu: right click, Shift+F10 or the Menu key from the focused link or the
 * "..." button, one registration however many rows. The resolver runs when a menu opens and returns nothing for a key that names no row.
 */
export const RowMenu = () => {
  const [rows, setRows] = useState<readonly Job[]>(SMALL);
  const [last, setLast] = useState('nothing');
  const menu = useMenu((key) => {
    const row = key === undefined ? undefined : rows.find((candidate) => candidate.key === key);
    if (row === undefined) {
      return null;
    }

    return [
      { kind: 'action', id: 'open', label: 'Open', icon: 'external-link', onSelect: () => {
        setLast(`Opened ${row.name}`); 
      } },
      { kind: 'action', id: 'copy', label: 'Copy name', icon: 'copy', onSelect: () => {
        setLast(`Copied ${row.name}`); 
      } },
      { kind: 'separator', id: 'before-remove' },
      { kind: 'action', id: 'remove', label: 'Remove\u2026', icon: 'trash', destructive: true, disabled: row.state === 'Running' ? 'A running job cannot be removed' : false, onSelect: () => {
        setRows((current) => current.filter((candidate) => candidate.key !== row.key));
        setLast(`Removed ${row.name}`);
      } },
    ];
  });
  const menuColumns = useMemo<ReadonlyArray<DataTableColumn<Job>>>(() => [
    {
      id: 'name',
      header: 'Name',
      fit: 'id',
      text: (row) => row.name,
      cell: (row) => (
        <button type="button" onClick={() => {
          setLast(`Opened ${row.name}`); 
        }}>{row.name}</button>
      ),
    },
    stateColumn,
    {
      id: 'actions',
      header: 'Actions',
      hideHeader: true,
      fit: 'fixed',
      width: 40,
      cell: (row) => <IconButton icon="ellipsis" label={`Actions for ${row.name}`} {...menuTrigger(menu, row.key)} />,
    },
  ], [menu]);
  return (
    <>
      <DataTable label="Jobs" rows={rows} getRowKey={getRowKey} columns={menuColumns} rowMenu={menu} maxHeight={320} />
      <p>{`Last: ${last}`}</p>
    </>
  );
};
