// The list page and the page header with invented data, for the probe (page-probe.mjs): the real `Shell` in its pane layout around the real `ListPage`,
// and the real `PageHeader` on its own. It is a second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it, because
// that build has ui-next/index.html as its only input. The words are neutral; the status words are the design mock's own.
//
//   ?case=list         89 items (78 Running, 9 Completed, 2 Failed, 0 Pending): the quick filters of the mock's list, a two-line identity, the default columns
//   ?case=refresh      the same, with a Refresh that stays open until the probe lets it end (window.__fixture.release())
//   ?case=transition   the same page, loading, until the probe asks for the rows (window.__fixture.ready())
//   ?case=loading      the states of the mock's `states` section, in its words (`items`, lower case) and its counts: 0 rows, still on their way
//   ?case=ready        5 items
//   ?case=empty        a whole set with nothing in it
//   ?case=no-match     24 items (the probe types a search that nothing matches)
//   ?case=error        a failure that left no rows, with a Retry (window.__fixture.counts.retries counts its presses)
//   ?case=error-bare   the same failure, with no way to try again: no Retry
//   ?case=header       a page header on its own with a block under it, as the mock's header section draws one: window.__fixture.header(shape, operation) chooses
//                      the shape (list, list-full, detail, detail-long, disabled, note) and the record in the operation slot
//   ?case=sort         89 items whose columns declare sort keys (Name, Ready as its fraction, Status, Restarts, Age as the time it was made) and a default sort on Name, ascending, for the sort probe (sort-probe.mjs).
//                      `&rows=5000` makes 5,000. window.__fixture.patch(key, changes) replaces one row with a changed copy, as a live update does; `rows()` reads the rows in the source's order; `keyReads()` counts
//                      the sort keys the table has read
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import {
  KindTile,
  MiddleEllipsis,
  PageHeader,
  Status,
  ThemeProvider,
  type DataTableColumn,
  type PageHeaderCommands,
  type PageHeaderProps,
  type PageOperation,
  type PageOperationAction,
  type PageOperationState,
  type StatusRole,
} from '@omniviewdev/kit';
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ListPage, type ListPageDefinition, type ListSource } from '..';
import type { ShellRegistration } from '../../shell';
import { StaticShell, STATIC_RAIL, staticTabs } from '../../shell/testing';
import { DetailCase, type DetailStart } from './detailCase';
import styles from './fixture.module.css';
const noop = () => undefined;


/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The items.                                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------------------------ */

type ItemStatus = 'Running' | 'Pending' | 'Failed' | 'Completed';

type Item = {
  readonly key: string;
  readonly name: string;
  readonly group: string;
  readonly ready: string;
  readonly status: ItemStatus;
  readonly restarts: number;
  readonly age: string;
  /** How old the item is, in seconds: what `age` says in a unit. */
  readonly ageSeconds: number;
};

const GROUPS = ['north-yard', 'south-yard', 'east-dock', 'west-dock'];
const KINDS = ['anvil', 'beacon', 'cinder', 'drifter', 'ember', 'falcon', 'garnet', 'harbor'];
const PARTS = ['feeder', 'mixer', 'relay', 'sorter'];
const AGES = ['17d', '3d', '5h', '42m', '9d', '26d', '2h', '58d'];
const AGE_SECONDS = [17 * 86_400, 3 * 86_400, 5 * 3_600, 42 * 60, 9 * 86_400, 26 * 86_400, 2 * 3_600, 58 * 86_400];
/* The two Failed and the nine Completed among 89: the counts of the mock's list (Running 78, Pending 0, Failed 2, Completed 9). */
const FAILED = new Set([17, 61]);
const COMPLETED = new Set([5, 14, 23, 32, 41, 50, 59, 68, 77]);

function statusOf(index: number): ItemStatus {
  if (FAILED.has(index)) {
    return 'Failed';
  }

  return COMPLETED.has(index) ? 'Completed' : 'Running';
}

function itemsOf(count: number): readonly Item[] {
  return Array.from({ length: count }, (_, index) => {
    const status = statusOf(index);
    const name = `${KINDS[index % KINDS.length] ?? 'item'}-${PARTS[Math.floor(index / KINDS.length) % PARTS.length] ?? 'part'}-${String(index + 1).padStart(3, '0')}`;
    return {
      key: `item-${String(index)}`,
      name,
      group: GROUPS[index % GROUPS.length] ?? 'yard',
      ready: status === 'Failed' ? '0/1' : index % 7 === 0 ? '2/2' : '1/1',
      status,
      restarts: status === 'Failed' ? 12 : index % 11 === 0 ? 3 : 0,
      age: AGES[index % AGES.length] ?? '1d',
      ageSeconds: AGE_SECONDS[index % AGE_SECONDS.length] ?? 86_400,
    };
  });
}

const ROLE_OF: Readonly<Record<Exclude<ItemStatus, 'Pending'>, Exclude<StatusRole, 'progress'>>> = { Running: 'running', Failed: 'error', Completed: 'healthy' };

function Identity({ row }: { readonly row: Item }) {
  return (
    <div className={styles.identity} data-fixture-key={row.key}>
      <KindTile icon="box" tone="blue" />
      <div className={styles.lines}>
        <MiddleEllipsis tail={4}>{row.name}</MiddleEllipsis>
        <small className={styles.second}>{row.group}</small>
      </div>
    </div>
  );
}

/** The default columns of a list of two-line items: the identity, a ready ratio, a status with its glyph, a restart count, an age. */
const COLUMNS: ReadonlyArray<DataTableColumn<Item>> = [
  {
    id: 'name',
    header: 'Name',
    fit: 'id',
    lead: 28,
    cell: (row) => <Identity row={row} />,
    text: (row) => [{ text: row.name }, { text: row.group, font: 'small' }],
    keepEnd: () => 4,
  },
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 59, align: 'end', cell: (row) => <span className={styles.mono}>{row.ready}</span> },
  {
    id: 'status',
    header: 'Status',
    fit: 'fixed',
    width: 157,
    cell: (row) =>
      row.status === 'Pending' ? (
        <Status role="progress" queued>
          {row.status}
        </Status>
      ) : (
        <Status role={ROLE_OF[row.status]}>{row.status}</Status>
      ),
  },
  { id: 'restarts', header: 'Restarts', fit: 'fixed', width: 72, align: 'end', cell: (row) => <span className={styles.mono}>{row.restarts}</span> },
  { id: 'age', header: 'Age', fit: 'fixed', width: 59, cell: (row) => row.age },
];

/** What the sort probe counts: how many times the table read a sort key (it reads a column's key of a row once and keeps it). */
const keyReads = { calls: 0 };

const counted =
  <TKey extends string | number>(read: (row: Item) => TKey) =>
    (row: Item): TKey => {
      keyReads.calls += 1;
      return read(row);
    };

/** `2/2` is 1 and `0/1` is 0: a ratio sorts by its fraction, the unhealthiest first when it ascends (and a total of 0 is whole). */
function readyFraction(ready: string): number {
  const [have = 0, total = 1] = ready.split('/').map(Number);
  return total === 0 ? 1 : have / total;
}

/** The sort keys of the columns as a plugin declares them: text, a ratio as its fraction, text, a count as numbers, and an age as when it was made (ascending is the oldest first). */
const SORT_KEYS: Readonly<Record<string, Pick<DataTableColumn<Item>, 'sortKey' | 'sortKind'>>> = {
  name: { sortKey: counted((row) => row.name) },
  ready: { sortKey: counted((row) => readyFraction(row.ready)), sortKind: 'number' },
  status: { sortKey: counted((row) => row.status) },
  restarts: { sortKey: counted((row) => row.restarts), sortKind: 'number' },
  age: { sortKey: counted((row) => -row.ageSeconds), sortKind: 'number' },
};

/** The same columns, each with its key: the sort case's. */
const SORT_COLUMNS: ReadonlyArray<DataTableColumn<Item>> = COLUMNS.map((column) => ({ ...column, ...SORT_KEYS[column.id] }));

type Words = 'Items' | 'items';

function definitionOf(words: Words, sortable = false): ListPageDefinition<Item> {
  return {
    title: words,
    nouns: words === 'Items' ? { one: 'Item', other: 'Items' } : { one: 'item', other: 'items' },
    columns: sortable ? SORT_COLUMNS : COLUMNS,
    ...(sortable ? { defaultSort: { column: 'name', direction: 'ascending' } as const } : {}),
    lines: 2,
    getRowKey: (row) => row.key,
    searchText: (row) => `${row.name} ${row.group} ${row.status}`.toLowerCase(),
    quickFilters: {
      label: 'Item state',
      filters: [
        { id: 'running', label: 'Running', tone: 'success', test: (row) => row.status === 'Running' },
        { id: 'pending', label: 'Pending', tone: 'warning', test: (row) => row.status === 'Pending' },
        { id: 'failed', label: 'Failed', tone: 'error', test: (row) => row.status === 'Failed' },
        { id: 'completed', label: 'Completed', tone: 'muted', test: (row) => row.status === 'Completed' },
      ],
    },
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* What the probe drives.                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** A record for the header's operation slot, as plain data the probe can send: the functions of the record are the fixture's. */
type OperationSpec = {
  readonly title: string;
  readonly state: PageOperationState;
  readonly text: string;
  readonly progress?: number | 'indeterminate';
  /** The record's commands, in order: a `cancel` while the work is active, a `retry` or an `open` once it ended. */
  readonly actions?: ReadonlyArray<'cancel' | 'retry' | 'open'>;
  /** The record takes a Dismiss. A calm outcome with a Dismiss clears itself after 8 s. */
  readonly dismiss?: boolean;
};

type Counts = {
  /** Refreshes the page asked of its source. */
  refreshes: number;
  /** Presses of the error's Retry. */
  retries: number;
  /** Dismissals of an operation record. */
  dismissals: number;
  /** The commands of an operation record that were pressed, by kind. */
  actions: string[];
};

type FixtureApi = {
  readonly counts: Counts;
  /** The list cases: lets every refresh the page asked for end. */
  release(): void;
  /** The `transition` case: the rows arrive. */
  ready(): void;
  /** The `header` case: the shape of the header and the record in its slot (`undefined`: the header declares no slot; `null`: the slot at rest). */
  header(shape: string, operation?: OperationSpec | null): void;
  /** The `header` case: the record in the slot. */
  operation(operation: OperationSpec | null): void;
  /** The `sort` case: replaces the row with this key by a copy with `changes`, as a live update does (a changed row is a new object, an unchanged one is the same). */
  patch?(key: string, changes: Partial<Omit<Item, 'key'>>): void;
  /** The `sort` case: the rows as the source holds them now, in its own order. */
  rows?(): readonly Item[];
  /** The `sort` case: how many sort keys the table has read since the page opened. */
  keyReads?(): number;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- augmenting the global Window takes an interface
  interface Window {
    __fixture?: FixtureApi;
  }
}

const counts: Counts = { refreshes: 0, retries: 0, dismissals: 0, actions: [] };

/** What the probe reads back is written here, outside the components: they only call it from their handlers. */
const bump = (key: 'refreshes' | 'retries' | 'dismissals') => {
  counts[key] += 1;
};

const pressed = (kind: string) => {
  counts.actions.push(kind);
};

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The shell around the page.                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------------------------ */

// The shell's one tab: the real tab model with an invented plugin behind it (shell/testing.tsx).
const tabs = staticTabs([{ title: 'Items', icon: 'box', path: ['Acme', 'north', 'Items'] }]);

const registration = (layout: 'pane' | 'document'): ShellRegistration => ({
  plugin: { name: 'Acme' },
  rail: STATIC_RAIL,
  layout,
  sidebar: {
    label: 'Acme resources',
    title: 'Resources',
    nodes: [{ id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'entry', label: 'Items', icon: 'box' }] }],
    open: ['group'],
    current: 'entry',
    accent: 'blue',
  },
  scope: [
    { label: 'Connection', icon: 'server', text: 'north' },
    { label: 'Scope', icon: 'folder-tree', text: 'Everything' },
  ],
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The list cases.                                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------ */

type ListConfig = {
  readonly words: Words;
  readonly count: number;
  readonly start: 'ready' | 'loading' | 'empty' | 'error';
  /** A refresh ends when the probe says so, not at once. */
  readonly holdsRefresh?: boolean;
  /** An error offers a Retry. */
  readonly retry?: boolean;
  /** The columns declare their sort keys and the list says it opens on Name, ascending. */
  readonly sortable?: boolean;
};

const LIST_CASES: Readonly<Record<string, ListConfig>> = {
  list: { words: 'Items', count: 89, start: 'ready' },
  refresh: { words: 'Items', count: 89, start: 'ready', holdsRefresh: true },
  transition: { words: 'Items', count: 89, start: 'loading' },
  loading: { words: 'items', count: 0, start: 'loading' },
  ready: { words: 'items', count: 5, start: 'ready' },
  empty: { words: 'items', count: 0, start: 'empty' },
  'no-match': { words: 'items', count: 24, start: 'ready' },
  error: { words: 'items', count: 0, start: 'error', retry: true },
  'error-bare': { words: 'items', count: 0, start: 'error', retry: false },
  sort: { words: 'Items', count: 89, start: 'ready', sortable: true },
};

type ListCaseProps = {
  readonly config: ListConfig;
  readonly definition: ListPageDefinition<Item>;
  readonly rows: readonly Item[];
};

function ListCase({ config, definition, rows }: ListCaseProps) {
  const [loaded, setLoaded] = useState(config.start !== 'loading');
  const [held] = useState<Array<() => void>>([]);
  // What the probe changed since the page opened, by key: the row that changed is a copy, and every other row is the one it was.
  const [changes, setChanges] = useState<ReadonlyMap<string, Partial<Item>>>(new Map());
  const current = useMemo(
    () =>
      rows.map((row) => {
        const change = changes.get(row.key);
        return change === undefined ? row : { ...row, ...change };
      }),
    [rows, changes],
  );

  useEffect(() => {
    window.__fixture = {
      counts,
      release: () => {
        for (const end of held.splice(0)) {
          end();
        }
      },
      ready: () => {
        flushSync(() => {
          setLoaded(true);
        });
      },
      header: noop,
      operation: noop,
      patch: (key, change) => {
        flushSync(() => {
          setChanges((previous) => new Map(previous).set(key, { ...previous.get(key), ...change }));
        });
      },
      rows: () => current,
      keyReads: () => keyReads.calls,
    };
  }, [held, current]);

  const refresh = async () => {
    bump('refreshes');
    if (config.holdsRefresh === true) {
      await new Promise<void>((resolve) => {
        held.push(resolve);
      });
    }
  };

  const retry = () => {
    bump('retries');
  };

  const failed = config.start === 'error';
  const source: ListSource<Item> = {
    state: failed
      ? { kind: 'failed', message: 'Retry to load it again.', retry: config.retry === true ? retry : undefined }
      : loaded
        ? { kind: 'ready' }
        : { kind: 'loading' },
    rows: loaded ? current : [],
    complete: loaded && !failed,
    refreshing: false,
    refresh,
  };

  return (
    <StaticShell registration={registration('pane')} tabs={tabs}>
      <ListPage definition={definition} source={source} />
    </StaticShell>
  );
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The header on its own.                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const path = [{ label: 'Acme', onSelect: noop }, { label: 'Items', onSelect: noop }, { label: 'orders-api' }] as const;

const refreshCommand = { id: 'refresh', label: 'Refresh Items', onSelect: noop } as const;

const detailCommands: PageHeaderCommands = {
  primary: { id: 'scale', label: 'Scale', icon: 'layers', onSelect: noop },
  secondary: [
    { id: 'edit', label: 'Edit', onSelect: noop },
    { id: 'restart', label: 'Restart', onSelect: noop },
  ],
  danger: { id: 'delete', label: 'Delete', onSelect: noop },
  utility: { ...refreshCommand, label: 'Refresh orders-api' },
  menu: [
    { id: 'labels', label: 'Edit labels', onSelect: noop },
    { id: 'copy', label: 'Copy name', onSelect: noop },
    { id: 'remove', label: 'Remove from list\u2026', destructive: true, onSelect: noop },
  ],
};

const detail: Omit<PageHeaderProps, 'operation'> = {
  path,
  tile: { icon: 'layers', tone: 'blue' },
  title: 'orders-api',
  state: { role: 'running', label: 'Running' },
  facts: [{ text: 'i-0a1b2c3d4e5f', mono: true, copy: { label: 'id', onCopy: noop } }, { text: 'Deployment' }, { text: 'checkout' }, { text: '3d' }],
  commands: detailCommands,
};

const SHAPES: Readonly<Record<string, Omit<PageHeaderProps, 'operation'>>> = {
  list: { title: 'Items', commands: { utility: refreshCommand } },
  'list-full': {
    title: 'Items',
    commands: { primary: { id: 'create', label: 'Create item', onSelect: noop }, utility: refreshCommand, menu: [{ id: 'selector', label: 'Label selector\u2026', onSelect: noop }] },
  },
  detail,
  'detail-long': {
    ...detail,
    title: 'orders-api-checkout-reconciliation-export-nightly-eu-west-1b',
    facts: [
      { text: 'i-0a1b2c3d4e5f6a7b8c9d0e1f2a3b', mono: true, copy: { label: 'id', onCopy: noop } },
      { text: 'Deployment-checkout-eu-west-1b' },
      { text: 'checkout-payments-blue-green-1' },
      { text: 'rolled-out-three-days-ago-argo' },
    ],
  },
  disabled: { ...detail, commands: { ...detailCommands, primary: { id: 'scale', label: 'Scale', icon: 'layers', onSelect: noop, disabledReason: 'Another change is running' } } },
  note: { path: [{ label: 'Acme', onSelect: noop }, { label: 'Items', onSelect: noop }, { label: 'Create' }], title: 'Create item', note: 'Name and group · step 1 of 3' },
};

const ACTION_LABEL = { cancel: 'Cancel', retry: 'Retry', open: 'Open' } as const;

function recordOf(spec: OperationSpec, dismiss: () => void): PageOperation {
  const actions = (spec.actions ?? []).map(
    (kind): PageOperationAction => ({
      id: kind,
      label: ACTION_LABEL[kind],
      kind: kind === 'open' ? 'custom' : kind,
      onSelect: () => {
        pressed(kind);
      },
    }),
  );
  return {
    title: spec.title,
    state: spec.state,
    text: spec.text,
    progress: spec.progress,
    actions,
    onDismiss: spec.dismiss === true ? dismiss : undefined,
  };
}

function HeaderCase() {
  const [shape, setShape] = useState('list');
  const [spec, setSpec] = useState<OperationSpec | null | undefined>(undefined);

  useEffect(() => {
    window.__fixture = {
      counts,
      release: noop,
      ready: noop,
      header: (next, operation) => {
        flushSync(() => {
          setShape(next);
          setSpec(operation);
        });
      },
      operation: (operation) => {
        flushSync(() => {
          setSpec(operation);
        });
      },
    };
  }, []);

  const dismiss = () => {
    bump('dismissals');
    setSpec(null);
  };

  const props = SHAPES[shape] ?? detail;
  const operation = spec === undefined || spec === null ? spec : recordOf(spec, dismiss);

  return (
    <StaticShell registration={registration('document')} tabs={tabs}>
      <div className={styles.top}>
        <PageHeader {...props} operation={operation} />
      </div>
      <div className={styles.next} data-fixture="next" />
    </StaticShell>
  );
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

const name = new URLSearchParams(window.location.search).get('case') ?? 'list';
const config = LIST_CASES[name];
const rowCount = Number(new URLSearchParams(window.location.search).get('rows') ?? config?.count ?? 0);
if (name !== 'header' && name !== 'detail' && config === undefined) {
  throw new Error(`Unknown case "${name}"`);
}

/** The detail case lets the probe bring the object in (`window.__fixture.ready()`), as the list's `transition` case does. */
const expose = (ready: () => void): void => {
  window.__fixture = { counts, release: noop, ready, header: noop, operation: noop };
};

const detailStart = (state: string | null): DetailStart => (state === 'loading' || state === 'deleted' || state === 'not-found' ? state : 'ready');

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    {name === 'detail' ? (
      <DetailCase start={detailStart(new URLSearchParams(window.location.search).get('state'))} expose={expose} />
    ) : config === undefined ? (
      <HeaderCase />
    ) : (
      <ListCase config={config} definition={definitionOf(config.words, config.sortable === true)} rows={itemsOf(rowCount)} />
    )}
  </ThemeProvider>,
);
