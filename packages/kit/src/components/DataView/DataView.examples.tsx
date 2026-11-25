import {
  Button,
  Chip,
  DataView,
  KindTile,
  MiddleEllipsis,
  PageHeader,
  ResourceCard,
  SearchField,
  Status,
  WorkspaceToolbar,
  type CardGridGroup,
  type CollectionFooterProps,
  type DataTableColumn,
  type DataTableSort,
  type DataViewState,
  type QuickFilter,
  type StatusRole,
} from '@omniviewdev/kit';
import { useMemo, useState } from 'react';
import styles from './DataView.examples.module.css';

// A collection written the way a consumer writes it: the rows, the columns and the choices are the caller's. The data is neutral: items of a
// service, each in a group, with a state, a count and an age.
type Item = {
  readonly key: string;
  readonly name: string;
  readonly group: string;
  readonly word: string;
  readonly role: StatusRole;
  readonly count: number;
  readonly age: string;
};

const WORDS: ReadonlyArray<readonly [string, StatusRole]> = [
  ['Running', 'running'],
  ['Running', 'running'],
  ['Running', 'running'],
  ['Pending', 'progress'],
  ['Failed', 'error'],
  ['Completed', 'healthy'],
];

const STEMS = ['orders-api', 'billing-worker', 'cache-primary', 'edge-proxy'];
const GROUPS = ['checkout', 'billing', 'platform'];

const ITEMS: readonly Item[] = Array.from({ length: 24 }, (_, index) => {
  const [word, role] = WORDS[index % WORDS.length] ?? ['Running', 'running'];
  return {
    key: `item-${String(index)}`,
    name: `${STEMS[index % STEMS.length] ?? 'item'}-${String(1000 + index * 7)}-x${String(index).padStart(2, '0')}`,
    group: GROUPS[index % GROUPS.length] ?? 'platform',
    word,
    role,
    count: (index * 13) % 9,
    age: `${String(1 + ((index * 5) % 40))}d`,
  };
});

const COLUMNS: ReadonlyArray<DataTableColumn<Item>> = [
  {
    id: 'name',
    header: 'Name',
    fit: 'id',
    lead: 28,
    cell: (row) => (
      <span className={styles.cell}>
        <KindTile icon="box" tone="blue" />
        <span className={styles.lines}>
          <MiddleEllipsis tail={6}>{row.name}</MiddleEllipsis>
          <span className={styles.group}>{row.group}</span>
        </span>
      </span>
    ),
    text: (row) => row.name,
    keepEnd: () => 6,
    sortKey: (row) => row.name,
  },
  {
    id: 'status',
    header: 'Status',
    fit: 'fixed',
    width: 157,
    cell: (row) => (row.role === 'progress' ? <Status role="progress" queued>{row.word}</Status> : <Status role={row.role}>{row.word}</Status>),
    sortKey: (row) => row.word,
  },
  { id: 'count', header: 'Count', fit: 'fixed', width: 72, align: 'end', cell: (row) => String(row.count), sortKey: (row) => row.count, sortKind: 'number' },
  { id: 'age', header: 'Age', fit: 'fixed', width: 59, cell: (row) => row.age },
];

const getRowKey = (row: Item) => row.key;

// The cards of the same items: one function for all, made once, so a card is drawn again only when its item changes.
const renderCard = (item: Item) => (
  <ResourceCard
    title={item.name}
    lead={<KindTile icon="server" />}
    status={<Status role={item.role}>{item.word}</Status>}
    meta={item.group}
    metrics={[
      { label: 'Count', value: String(item.count) },
      { label: 'Age', value: item.age },
    ]}
    actions={<Button>Open</Button>}
  />
);

// The cards of a group are the items that are in it: a group with none is not drawn.
function groupsOf(rows: readonly Item[]): Array<CardGridGroup<Item>> {
  return GROUPS.map((name) => {
    const items = rows.filter((row) => row.group === name);
    return { id: name, title: name, meta: `${String(items.length)} ${items.length === 1 ? 'item' : 'items'}`, items };
  });
}

type StateFilter = { readonly id: string; readonly label: string; readonly tone: QuickFilter['tone']; readonly test: (row: Item) => boolean };

const STATES: readonly StateFilter[] = [
  { id: 'running', label: 'Running', tone: 'success', test: (row) => row.word === 'Running' },
  { id: 'pending', label: 'Pending', tone: 'warning', test: (row) => row.word === 'Pending' },
  { id: 'failed', label: 'Failed', tone: 'error', test: (row) => row.word === 'Failed' },
  { id: 'completed', label: 'Completed', tone: 'muted', test: (row) => row.word === 'Completed' },
];

type PaneProps = {
  /** The state of the body. Ready lists the rows (the search and the filter work); the others show their own body. */
  readonly state?: DataViewState | undefined;
  readonly initialSearch?: string | undefined;
  /** Rows still arriving: the footer says how many are loaded, and not how many there are. */
  readonly loading?: boolean | undefined;
  /** Which body the pane starts with: the table, or the cards in groups. */
  readonly initialView?: 'table' | 'cards' | undefined;
  /** Offers the choice between the two at the end of the toolbar. The header, the strip, the toolbar and the footer stay where they are. */
  readonly switchable?: boolean | undefined;
  /** The data is being read again: the footer says so at its end. */
  readonly refreshing?: boolean | undefined;
};

function Pane({ state = { kind: 'ready' }, initialSearch = '', loading = false, initialView = 'table', switchable = false, refreshing = false }: PaneProps) {
  const [draft, setDraft] = useState(initialSearch);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<DataTableSort | undefined>({ column: 'name', direction: 'ascending' });
  const [view, setView] = useState(initialView);

  const listing = state.kind === 'ready';
  const query = draft.trim().toLowerCase();
  // The strip counts what the search left, before the chosen state (design 13 QF1): its counts add up to the count of All.
  const searched = useMemo(() => (listing ? ITEMS.filter((item) => item.name.includes(query) || item.group.includes(query)) : []), [listing, query]);
  const chosen = STATES.find((candidate) => candidate.id === selected);
  const rows = chosen === undefined ? searched : searched.filter(chosen.test);
  const filtered = query !== '' || chosen !== undefined;
  const known = state.kind !== 'loading' && state.kind !== 'error';

  const counted: CollectionFooterProps =
    loading || !known
      ? { shown: rows.length, total: { kind: 'unknown' }, noun: 'item', plural: 'items' }
      : { shown: rows.length, total: { kind: 'exact', value: state.kind === 'empty' ? 0 : ITEMS.length }, noun: 'item', plural: 'items' };
  const footer: CollectionFooterProps = refreshing ? { ...counted, status: { text: 'Refreshing…', busy: true } } : counted;
  const header = <PageHeader title="Items" commands={{ utility: { id: 'refresh', label: 'Refresh items', onSelect: () => undefined } }} />;
  const quickFilters = {
    label: 'Item state',
    total: known ? searched.length : undefined,
    filters: STATES.map((candidate) => ({ id: candidate.id, label: candidate.label, tone: candidate.tone, count: known ? searched.filter(candidate.test).length : undefined })),
    selected,
    onSelect: setSelected,
  };
  const toolbar = (
    <WorkspaceToolbar
      label="Search and filter items"
      end={
        switchable ? (
          <>
            <Chip
              pressed={view === 'table'}
              onClick={() => {
                setView('table');
              }}
            >
              Table
            </Chip>
            <Chip
              pressed={view === 'cards'}
              onClick={() => {
                setView('cards');
              }}
            >
              Cards
            </Chip>
          </>
        ) : undefined
      }
    >
      <SearchField label="Search items" value={draft} onValueChange={setDraft} />
      {filtered ? (
        <Button
          variant="ghost"
          size="compact"
          icon="close"
          onClick={() => {
            setDraft('');
            setSelected(null);
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </WorkspaceToolbar>
  );
  const shownState: DataViewState = listing && rows.length === 0 && filtered ? { kind: 'no-match' } : state;

  return (
    <div className={styles.pane}>
      {view === 'cards' ? (
        <DataView<Item>
          label="Items"
          header={header}
          quickFilters={quickFilters}
          toolbar={toolbar}
          cards={{ groups: groupsOf(rows), getKey: getRowKey, renderCard }}
          footer={footer}
          state={shownState}
        />
      ) : (
        <DataView<Item>
          label="Items"
          header={header}
          quickFilters={quickFilters}
          toolbar={toolbar}
          table={{ rows, getRowKey, columns: COLUMNS, lines: 2, sort, onSortChange: setSort, rowsAreImmutable: true }}
          footer={footer}
          state={shownState}
        />
      )}
    </div>
  );
}

/** The whole collection: the header, the quick filters with counts that add up, the search, a sortable table of two-line rows and the footer's count. Search, choose a state, sort. */
export const Ready = () => <Pane />;

/** The set is still arriving (decision A10): the rows that are here are listed, and the footer says how many are loaded and not how many there are. */
export const Loaded = () => <Pane loading />;

/** The first load: the header, the strip, the toolbar and the footer stay; the skeleton takes the rows' place after 250 ms. */
export const Loading = () => <Pane state={{ kind: 'loading' }} />;

/** Nothing to list: the table's header kept, one line under it, and the count says so. */
export const Empty = () => <Pane state={{ kind: 'empty', hint: 'Items appear here when they are created.' }} />;

/** A search that matched nothing keeps the header and the count ("0 of 24 items"), says "No Items match", and the toolbar offers the one Clear filters. */
export const FilteredEmpty = () => <Pane initialSearch="zzz" />;

/** A failure with no rows to keep: one notice in place of them, and one Retry because there is a way to try again. The footer repeats nothing. */
export const Failure = () => <Pane state={{ kind: 'error', message: 'The server did not answer in time.', onRetry: () => undefined }} />;

/** The same failure when there is nothing to retry with: no Retry, because a button that does nothing is a stub. */
export const FailureWithoutRetry = () => <Pane state={{ kind: 'error', message: 'You do not have access to these items.' }} />;

/** The same collection as cards under the same header, strip, toolbar and footer: the items in groups, a card for each. Search, choose a state: the groups follow. */
export const Cards = () => <Pane initialView="cards" />;

/** The first load shown as cards: blocks in the grid's columns, after 250 ms, in a busy status named for what loads. */
export const CardsLoading = () => <Pane initialView="cards" state={{ kind: 'loading' }} />;

/** Nothing to list: one line in the body, no table header to keep, and the count says so. */
export const CardsEmpty = () => <Pane initialView="cards" state={{ kind: 'empty', hint: 'Items appear here when they are created.' }} />;

/** A search that matched nothing says "No Items match" in the body and keeps the toolbar's Clear filters. */
export const CardsFilteredEmpty = () => <Pane initialView="cards" initialSearch="zzz" />;

/** A failure with nothing to show: the same notice and Retry in place of the cards. The footer repeats nothing. */
export const CardsFailure = () => <Pane initialView="cards" state={{ kind: 'error', message: 'The server did not answer in time.', onRetry: () => undefined }} />;

/** The data is being read again: the footer says so at its end, muted, and does not announce it. */
export const CardsRefreshing = () => <Pane initialView="cards" refreshing />;

/** Switching from the table to the cards (and back) changes the body and nothing else: the header, the strip, the toolbar and the footer stay as they are. Press Cards. */
export const SwitchingViews = () => <Pane switchable />;
