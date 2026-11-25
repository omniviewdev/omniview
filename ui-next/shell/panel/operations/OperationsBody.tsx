import { DataView, ErrorBody, IconButton, MissingValue, ProgressBar, Status, tip, useAge, type DataTableColumn } from '@omniviewdev/kit';
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { PanelEmpty } from '../PanelEmpty';
import type { OpenSubject } from '../subject';
import { ago, stampOf } from './ago';
import styles from './Operations.module.css';
import { OPERATIONS_EMPTY, OPERATIONS_ICON, OPERATIONS_UNAVAILABLE } from './tool';
import type { Operation, Operations } from './types';
import { CANCELING, CANCELING_FACE, NO_PROGRESS, NO_START, NO_TARGET, OPEN_ICON, STATE_FACES, type StateFace } from './words';

// The body of the Operations tool (ch16 S122: "an `H.dataView` over the record store"): the empty words, or what the window says when it could not read the activity service (the feed's error: a failed read holds no task either, and "No operations"
// would say what the window does not know), or the table of the host's tasks, running first, with the footer's count. It draws what the model says (./model.ts) and decides nothing: the order, the words of progress, what Cancel may say
// and what is unread are the model's. First slice: no Duration (no producer says when a task finished: `updatedAt` moves with every read mark), no filter, no sort, no inspector and no toolbar.

/**
 * S81, the notification centre's rule: a record is read when the surface that lists it has been open for a second while it was listed. The host mounts this body only while the tool is on screen with the panel open. The second is each
 * record's own, from the moment this body listed it: a record that arrives later neither starts an older one's again nor is read before its own is over.
 */
const READ_AFTER_MS = 1000;

/** The unread ids this body listed in one change, which share one timer: each of them was listed when the others were, so its second ends when that timer does. */
type Listing = { readonly ids: readonly string[] };

/** What the cells of a row do: a cell is a function of its row alone (the table renders a cell again only when its row changes), so the two things a button needs that are not the row's come down by context. */
type Commands = { readonly cancel: Operations['cancel']; readonly open: OpenSubject };

const CommandsContext = createContext<Commands | null>(null);

function useCommands(): Commands {
  const commands = useContext(CommandsContext);
  if (commands === null) {
    throw new Error('A cell of the Operations table was rendered outside its body.');
  }

  return commands;
}

/** Words of a cell that may be cut: the title, the source, the connection. The cell cuts them with an ellipsis and the window's one tooltip says them whole while they are cut. */
function Clipped({ children }: { readonly children: string }) {
  return (
    <span className={styles.clip} data-ov-clip="">
      {children}
    </span>
  );
}

function statusOf(face: StateFace, cause: string | undefined) {
  return face.role === 'progress' ? (
    <Status role="progress" queued={face.queued} {...tip(cause)}>
      {face.word}
    </Status>
  ) : (
    <Status role={face.role} {...tip(cause)}>
      {face.word}
    </Status>
  );
}

/** The state: the producer's word for it, or "Canceling…" while a request to stop is pending. A failure and an outcome nobody knows say what the producer said as the tip: the word is short and the cause is not. */
function stateCell(row: Operation): ReactNode {
  if (row.active && row.cancel === 'requested') {
    return statusOf(CANCELING_FACE, undefined);
  }

  return statusOf(STATE_FACES[row.state], row.state === 'failed' || row.state === 'unknown' ? row.message : undefined);
}

/** The producer's count: a 4 px bar named for the work (the bar is the picture, the words are the producer's), or a dash for what cannot be measured. A count that is not a part of a whole has its words and no bar. */
function ProgressCell({ row }: { readonly row: Operation }) {
  const face = row.progress;
  if (face === undefined) {
    return <MissingValue name={NO_PROGRESS} />;
  }

  return (
    <span className={styles.progress}>
      {face.fraction === undefined ? null : (
        <span className={styles.bar}>
          <ProgressBar label={row.title} value={face.fraction * 100} valueText={face.text} />
        </span>
      )}
      <span className={styles.progressText} data-ov-clip="">
        {face.text}
      </span>
    </span>
  );
}

/** When the host first had the record: the mock's words on the page's one age clock, and the instant in the machine's own time with the seconds as the tip (it has no words of its own: they would be a second rule to disagree with the first). */
function StartedCell({ at }: { readonly at: number }) {
  const words = useAge(at, ago);
  if (!Number.isFinite(at)) {
    return <MissingValue name={NO_START} />;
  }

  return (
    <time dateTime={new Date(at).toISOString()} {...tip(stampOf(at))}>
      {words}
    </time>
  );
}

/**
 * Cancel and Open, in that order (a row is not a Tab stop, so its action is also a button in it). Cancel is drawn only when the producer offers it (S84); while a request is pending it keeps its place, unavailable, with the reason.
 * Open goes to the thing the row is about: the connection when the window knows it, else the plugin; the host's own work has no page and no Open.
 */
function ActionsCell({ row }: { readonly row: Operation }) {
  const { cancel, open } = useCommands();
  const { subject } = row;
  const pending = row.cancel === 'requested';
  const where = `Open ${row.target ?? row.source.name}`;
  return (
    <span className={styles.actions}>
      {row.cancel === 'none' ? null : (
        <IconButton
          icon="close"
          variant="ghost"
          size="row"
          label={`Cancel ${row.title}`}
          disabledReason={pending ? CANCELING : undefined}
          {...tip(pending ? CANCELING : 'Cancel')}
          onClick={() => {
            void cancel(row.id);
          }}
        />
      )}
      {subject === undefined ? null : (
        <IconButton
          icon={OPEN_ICON}
          variant="ghost"
          size="row"
          label={where}
          {...tip(where)}
          onClick={(event) => {
            open(subject, event);
          }}
        />
      )}
    </span>
  );
}

/**
 * The columns of the mock less the Duration, in its widths (shell-panel.css: 128, 160, 152, 144, 104 and 76 px for the actions). The Operation column is the identity column: it takes the room the fixed ones leave (the mock's own
 * collapsed on a narrow table) and clips last. One list for the life of the module: the table's cells and its fit are made from it once.
 */
const COLUMNS: ReadonlyArray<DataTableColumn<Operation>> = [
  { id: 'operation', header: 'Operation', fit: 'id', text: (row) => row.title, cell: (row) => <Clipped>{row.title}</Clipped> },
  { id: 'source', header: 'Source', fit: 'fixed', width: 128, cell: (row) => <Clipped>{row.source.name}</Clipped> },
  { id: 'target', header: 'Target', fit: 'fixed', width: 160, cell: (row) => (row.target === undefined ? <MissingValue name={NO_TARGET} /> : <Clipped>{row.target}</Clipped>) },
  { id: 'state', header: 'State', fit: 'fixed', width: 152, cell: stateCell },
  { id: 'progress', header: 'Progress', fit: 'fixed', width: 144, cell: (row) => <ProgressCell row={row} /> },
  { id: 'started', header: 'Started', fit: 'fixed', width: 104, cell: (row) => <StartedCell at={row.startedAt} /> },
  { id: 'actions', header: 'Actions', hideHeader: true, fit: 'fixed', width: 76, cell: (row) => <ActionsCell row={row} /> },
];

const keyOf = (row: Operation): string => row.id;

export type OperationsBodyProps = {
  readonly operations: Operations;
  /** Opens where a row goes, in the way the click or key that chose it says (a background tab, a new tab): the host's. */
  readonly open: OpenSubject;
};

export function OperationsBody({ operations, open }: OperationsBodyProps): ReactElement {
  const { rows, unread, unavailable } = useSyncExternalStore(operations.subscribe, operations.getSnapshot);
  const ids = unread.ids;

  // The unread ids this body lists, each with the listing (and so the timer) that carries its second. An id is asked for once, when its listing's timer runs, and not again while it stays unread: a failed mark leaves the id unread and
  // listed, the model logs it, and the row stays unread for the next time the tool is shown. An id that is read (here, or from another window) leaves, and a later unread of the same id is a new listing with a second of its own.
  const listed = useRef(new Map<string, Listing>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const unreadNow = new Set(ids);
    for (const id of listed.current.keys()) {
      if (!unreadNow.has(id)) {
        listed.current.delete(id);
      }
    }

    const fresh = ids.filter((id) => !listed.current.has(id));
    if (fresh.length === 0) {
      return;
    }

    const listing: Listing = { ids: fresh };
    for (const id of fresh) {
      listed.current.set(id, listing);
    }

    const timer = setTimeout(() => {
      timers.current.delete(timer);
      const due = listing.ids.filter((id) => listed.current.get(id) === listing);
      if (due.length > 0) {
        void operations.markRead(due);
      }
    }, READ_AFTER_MS);
    timers.current.add(timer);
  }, [operations, ids]);

  // The tool leaves the screen: no second runs any more, and the next time it is shown every unread failure begins its own.
  useEffect(
    () => () => {
      for (const timer of timers.current) {
        clearTimeout(timer);
      }

      timers.current.clear();
      listed.current.clear();
    },
    [operations],
  );

  if (rows.length === 0) {
    // A failed read and a read of no activity both hold no row: only the second is "No operations". Rows the window already holds are listed whatever the feed says, so this is the case of none.
    return unavailable === undefined ? (
      <PanelEmpty icon={OPERATIONS_ICON} title={OPERATIONS_EMPTY.title} hint={OPERATIONS_EMPTY.hint} />
    ) : (
      <div className={styles.operations}>
        <ErrorBody title={OPERATIONS_UNAVAILABLE.title} message={unavailable} />
      </div>
    );
  }

  const activate = (row: Operation, event: MouseEvent<HTMLElement>): void => {
    if (row.subject !== undefined) {
      open(row.subject, event);
    }
  };

  return (
    <CommandsContext value={{ cancel: operations.cancel, open }}>
      <div className={styles.operations}>
        <DataView<Operation>
          label="Operations"
          table={{ rows, getRowKey: keyOf, columns: COLUMNS, lines: 1, rowsAreImmutable: true, onRowActivate: activate }}
          footer={{ shown: rows.length, total: { kind: 'exact', value: rows.length }, noun: 'operation', plural: 'operations' }}
        />
      </div>
    </CommandsContext>
  );
}
