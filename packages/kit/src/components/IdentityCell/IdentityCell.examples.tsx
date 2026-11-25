import {
  Avatar,
  DataTable,
  IdentityCell,
  KindTile,
  LinkProvider,
  type DataTableColumn,
  type IdentityMark,
  type LinkHandler,
  type LinkTarget,
} from '@omniviewdev/kit';
import styles from './IdentityCell.examples.module.css';

const hrefOf = (target: LinkTarget) => {
  const params = Object.entries<string>(target.params ?? {}).map(([key, value]) => `${key}=${value}`);
  return `#/${target.page}${params.length === 0 ? '' : `?${params.join('&')}`}`;
};

// A handler that goes nowhere: the examples are about the look of the cell.
const QUIET: LinkHandler = { hrefOf, onOpen: () => undefined };

const TARGET: LinkTarget = { page: 'connections', params: { name: 'connection-a' } };
const PINNED: readonly IdentityMark[] = [{ icon: 'pin', label: 'Pinned' }];

/** Just a name, on one line. */
export const Plain = () => <IdentityCell name="Connection A" />;

/** The name is a link to a destination in the host: the cell's one Tab stop. */
export const WithLink = () => (
  <LinkProvider handler={QUIET}>
    <IdentityCell name="Connection A" to={TARGET} />
  </LinkProvider>
);

/** A muted line under the name. */
export const WithDetail = () => <IdentityCell name="Connection A" detail="Platform · production" />;

/** A `KindTile` of 16 px before the name. */
export const WithKindTile = () => <IdentityCell lead={<KindTile icon="server" size={16} />} name="Connection A" detail="Platform · production" />;

/** An `Avatar` of 16 px, square, before the name. */
export const WithAvatar = () => (
  <IdentityCell lead={<Avatar name="Connection A" size={16} shape="square" icon="server" />} name="Connection A" detail="Platform · production" />
);

/** A mark after the name: a glyph that says something about it. Its word is read by assistive technology and never drawn. */
export const WithMark = () => <IdentityCell name="Connection A" marks={PINNED} />;

/** A name longer than its line gives way with an ellipsis, and the lead and the mark stay whole. The whole name is the tooltip while it is cut. */
export const LongNameClips = () => (
  <div className={styles.narrow}>
    <LinkProvider handler={QUIET}>
      <IdentityCell
        lead={<Avatar name="Connection A" size={16} shape="square" icon="server" />}
        name="A connection whose name is longer than the line it is given"
        to={TARGET}
        marks={PINNED}
        detail="Platform · a second line that is longer than the line it is given"
      />
    </LinkProvider>
  </div>
);

type Entry = { readonly key: string; readonly name: string; readonly detail: string; readonly pinned: boolean };

const ENTRIES: readonly Entry[] = [
  { key: 'a', name: 'Connection A', detail: 'Platform · production', pinned: true },
  { key: 'b', name: 'A connection whose name is longer than its column can hold', detail: 'Platform · staging', pinned: true },
  { key: 'c', name: 'Connection C', detail: 'Other platform · development', pinned: false },
];

const getEntryKey = (entry: Entry) => entry.key;

// A column list keeps its identity: it is built once, outside the component.
const COLUMNS: ReadonlyArray<DataTableColumn<Entry>> = [
  {
    id: 'name',
    header: 'Connection',
    fit: 'id',
    lead: 24,
    trail: 16,
    text: (entry) => [{ text: entry.name }, { text: entry.detail, font: 'small' }],
    cell: (entry) => (
      <IdentityCell
        lead={<Avatar name={entry.name} size={16} shape="square" icon="server" />}
        name={entry.name}
        to={{ page: 'connections', params: { name: entry.key } }}
        marks={entry.pinned ? PINNED : undefined}
        detail={entry.detail}
      />
    ),
  },
  { id: 'status', header: 'Status', fit: 'fixed', width: 120, cell: () => 'Connected' },
];

/** The cell of the identity column of a table of two-line rows: the lead and the marks are held in the column's widths, and the name takes what is left. */
export const InTable = () => (
  <LinkProvider handler={QUIET}>
    <DataTable label="Connections" rows={ENTRIES} getRowKey={getEntryKey} columns={COLUMNS} lines={2} maxHeight={200} />
  </LinkProvider>
);
