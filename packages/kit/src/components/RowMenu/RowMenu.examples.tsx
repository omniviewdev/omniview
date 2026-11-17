import { DataTable, RowMenu, RowMenuTrigger, Stack, Text, createRowMenu, type DataTableColumn, type RowMenuItem } from '@omniviewdev/kit';
import { useMemo, useState } from 'react';

type Job = { readonly key: string; readonly name: string; readonly state: 'Running' | 'Paused' | 'Failed' };

const STATES: ReadonlyArray<Job['state']> = ['Running', 'Paused', 'Running', 'Failed', 'Running'];
const jobs = (count: number): Job[] =>
  Array.from({ length: count }, (_, index) => ({ key: `job-${index}`, name: `worker-${index + 1}`, state: STATES[index % STATES.length] ?? 'Running' }));

const SMALL = jobs(12);
const LARGE = jobs(5000);
const getRowKey = (row: Job) => row.key;

/** One table, one menu: a trigger in each row opens the table's one menu for that row, and the menu acts on the row that opened it. */
export const Default = () => {
  // One handle for each table, made once; the menu is mounted once, beside the table, with the same handle.
  const [handle] = useState(() => createRowMenu<Job>());
  const [last, setLast] = useState('nothing');
  // A column list keeps its identity: it is built once for the handle.
  const columns = useMemo<ReadonlyArray<DataTableColumn<Job>>>(
    () => [
      { id: 'name', header: 'Name', fit: 'flex', text: (row) => row.name, cell: (row) => row.name },
      { id: 'actions', header: 'Actions', fit: 'fixed', width: 48, cell: (row) => <RowMenuTrigger handle={handle} row={row} label={`Actions for ${row.name}`} /> },
    ],
    [handle],
  );
  // Called only while the menu is open, with the row that opened it (this menu offers the same four to every row); `onSelect` gets that row too.
  const items = (): ReadonlyArray<RowMenuItem<Job>> => [
    { id: 'inspect', label: 'Inspect', onSelect: (target) => {
      setLast(`inspect ${target.name}`);
    } },
    { id: 'rerun', label: 'Run again', onSelect: (target) => {
      setLast(`run ${target.name} again`);
    } },
    { id: 'copy', label: 'Copy name', onSelect: (target) => {
      setLast(`copy ${target.name}`);
    } },
    { id: 'delete', label: 'Delete\u2026', destructive: true, separatorBefore: true, onSelect: (target) => {
      setLast(`delete ${target.name}`);
    } },
  ];
  return (
    <Stack gap={8}>
      <DataTable label="Jobs" rows={SMALL} getRowKey={getRowKey} columns={columns} maxHeight={320} rowsAreImmutable />
      <RowMenu handle={handle} label="Job actions" items={items} />
      <Text variant="caption" tone="muted">{`Last action: ${last}`}</Text>
    </Stack>
  );
};

/** 5,000 rows: one popup for all of them, and a trigger only in the rows in view. Open it from the top, the middle and the bottom of the table. */
export const Large = () => {
  const [handle] = useState(() => createRowMenu<Job>());
  const [last, setLast] = useState('nothing');
  const columns = useMemo<ReadonlyArray<DataTableColumn<Job>>>(
    () => [
      { id: 'name', header: 'Name', fit: 'flex', text: (row) => row.name, cell: (row) => row.name },
      { id: 'actions', header: 'Actions', fit: 'fixed', width: 48, cell: (row) => <RowMenuTrigger handle={handle} row={row} label={`Actions for ${row.name}`} /> },
    ],
    [handle],
  );
  const items = (): ReadonlyArray<RowMenuItem<Job>> => [
    { id: 'inspect', label: 'Inspect', onSelect: (target) => {
      setLast(`inspect ${target.name}`);
    } },
    { id: 'rerun', label: 'Run again', onSelect: (target) => {
      setLast(`run ${target.name} again`);
    } },
    { id: 'copy', label: 'Copy name', onSelect: (target) => {
      setLast(`copy ${target.name}`);
    } },
    { id: 'delete', label: 'Delete\u2026', destructive: true, separatorBefore: true, onSelect: (target) => {
      setLast(`delete ${target.name}`);
    } },
  ];
  return (
    <Stack gap={8}>
      <DataTable label="Jobs" rows={LARGE} getRowKey={getRowKey} columns={columns} maxHeight={360} rowsAreImmutable />
      <RowMenu handle={handle} label="Job actions" items={items} />
      <Text variant="caption" tone="muted">{`Last action: ${last}`}</Text>
    </Stack>
  );
};

/** An item that cannot apply to a row stays in the menu, announced as unavailable and skipped by the arrow keys; a destructive one is set apart and says what it is. */
export const DisabledAndDestructive = () => {
  const [handle] = useState(() => createRowMenu<Job>());
  const [last, setLast] = useState('nothing');
  const columns = useMemo<ReadonlyArray<DataTableColumn<Job>>>(
    () => [
      {
        id: 'name',
        header: 'Name',
        fit: 'flex',
        text: (row) => [{ text: row.name }, { text: row.state, font: 'small' }],
        cell: (row) => (
          <>
            <div>{row.name}</div>
            <div>{row.state}</div>
          </>
        ),
      },
      { id: 'actions', header: 'Actions', fit: 'fixed', width: 48, cell: (row) => <RowMenuTrigger handle={handle} row={row} label={`Actions for ${row.name}`} /> },
    ],
    [handle],
  );
  const items = (row: Job): ReadonlyArray<RowMenuItem<Job>> => [
    { id: 'inspect', label: 'Inspect', onSelect: (target) => {
      setLast(`inspect ${target.name}`);
    } },
    { id: 'pause', label: 'Pause', disabled: row.state !== 'Running', onSelect: (target) => {
      setLast(`pause ${target.name}`);
    } },
    { id: 'resume', label: 'Resume', disabled: row.state !== 'Paused', onSelect: (target) => {
      setLast(`resume ${target.name}`);
    } },
    { id: 'delete', label: 'Delete\u2026', destructive: true, separatorBefore: true, onSelect: (target) => {
      setLast(`delete ${target.name}`);
    } },
  ];
  return (
    <Stack gap={8}>
      <DataTable label="Jobs" rows={SMALL} getRowKey={getRowKey} columns={columns} lines={2} maxHeight={360} rowsAreImmutable />
      <RowMenu handle={handle} label="Job actions" items={items} />
      <Text variant="caption" tone="muted">{`Last action: ${last}`}</Text>
    </Stack>
  );
};
