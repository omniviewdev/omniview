import { Button, EmptyState, Icon, RovingGroup, menuTrigger, useMenu, type MenuItem } from '@omniviewdev/kit';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import type { NoticesStore, RecordView } from '../core/notices';
import type { Centre } from './centreControl';
import { focusInto, idOf, rowsOf, showPopover, type Place } from './centreDom';
import { listOf, nameOfSource, sourcesOf } from './centreList';
import { emptyOf, mutedNote, olderLabel, said, undoLabel } from './centreWords';
import { CentreRow } from './CentreRow';
import { useNotices } from './context';
import { DayHeading } from './DayHeading';
import styles from './Centre.module.css';
import { useRows } from './useRows';

// The notification centre (ch16 S80, S81, O4; the mock's `centerBody`, `listHtml`, `barHtml` and `emptyHtml`, shell-feedback.js): the popover the bell opens, the history of the model, newest first, under Recent and a
// heading for each day. Its bar has Mark all as read, Clear finished (Undo for ten seconds after it) and the Filter menu, which is where a source is chosen and muted; under the bar a note says which source the list is
// narrowed to and which are muted. Each row is the model's record drawn once for every surface (./CentreRow.tsx).
//
// Mounting is opening: the popover is drawn only while it is open (S151: a closed popover holds no live rendering), so a closed centre holds no row, no listener and no timer. While it is open the toast stack waits
// (`hold('center')`, S89a: the records a toast stood for are in the list), the focus is in it, and Escape or a press outside closes it and gives the focus back to the bell. What the centre listed is read when it
// closes, if it was open for a second (S81: opening keeps every row as it was).
//
// NOT built here, because the step is the history and not the views of it: the segmented view (All, Unread, Active, Needs attention), the severity group of the Filter menu, the details of a record (its diagnostics and
// Copy), the Active group and its progress (operations), and the footer's two links (Open Operations, Notification settings): none of them has anything to open yet.

export type CentreProps = {
  readonly id: string;
  /** Where the popover stands: measured against the bell before it is drawn. */
  readonly place: Place;
  readonly centre: Centre;
  /** The bell: where the focus goes back to, and the one place a press does not count as outside. */
  readonly invoker: RefObject<HTMLElement | null>;
};

/** A focus owed after the next draw: to the neighbour of a row that was removed, once it has left, or to the first row that "Show older" revealed, once it is there. */
type Later = { readonly kind: 'gone'; readonly id: string; readonly index: number } | { readonly kind: 'shown'; readonly id: string };

/** What the centre listed is read when it closes after being open a second, each record counted from the moment it was last listed (the mock's `centerClosed`, S81). */
function markSeen(store: NoticesStore, records: readonly RecordView[], openedAt: number): void {
  const early: string[] = [];
  for (const record of records) {
    const since = Math.max(openedAt, record.finishedAt ?? 0, record.createdAt);
    if (since === openedAt) {
      early.push(record.id);
    } else {
      store.seen([record.id], { since });
    }
  }

  if (early.length > 0) {
    store.seen(early, { since: openedAt });
  }
}

export function CentrePopover({ id, place, centre, invoker }: CentreProps) {
  const { store, announcer } = useNotices();
  const recent = useSyncExternalStore(store.subscribe, store.selectors.recent);
  const counts = useSyncExternalStore(store.subscribe, store.selectors.counts);
  const muted = useSyncExternalStore(store.subscribe, () => store.getSnapshot().muted);
  const undo = useSyncExternalStore(store.subscribe, () => store.getSnapshot().undo);
  const { source } = useSyncExternalStore(centre.subscribe, centre.getSnapshot);
  // When it opened: where "open for a second" is counted from (S81). What Today is is not fixed at this moment: a day's heading follows the clock (`DayHeading`).
  const [openedAt] = useState(() => Date.now());
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const later = useRef<Later | null>(null);
  const listed = useRef<readonly RecordView[]>([]);

  const view = listOf(recent, { source, more });
  const empty = emptyOf({ total: recent.length, matched: view.matched.length, undo });
  const name = nameOfSource(recent, muted, source);
  const note = mutedNote(muted);
  const sourceMuted = source !== '' && muted.some((entry) => entry.source === source);
  const filterRevision = JSON.stringify([source, name, sourceMuted]);

  const tell = (text: string): void => {
    announcer.announce(text, { urgent: false });
  };

  const clearFilters = (): void => {
    centre.filter('');
    root.current?.querySelector<HTMLButtonElement>('[data-notices-part="filter"]')?.focus({ preventScroll: true });
  };

  const menuId = useMenu(() => {
    const items: MenuItem[] = [{ kind: 'radio', id: 'source', label: 'Source', value: source, options: sourcesOf(recent, source), onChange: centre.filter }];
    if (source !== '') {
      items.push(
        { kind: 'separator', id: 'source-actions' },
        {
          kind: 'action',
          id: 'mute',
          icon: sourceMuted ? 'bell' : 'bell-off',
          label: sourceMuted ? `Unmute ${name}` : `Mute ${name} for 1 hour`,
          onSelect: () => {
            const changed = sourceMuted ? store.unmute(source) : store.mute(source);
            if (changed) {
              tell(sourceMuted ? said.unmuted(name) : said.muted(name));
            }
          },
        },
        {
          kind: 'action',
          id: 'clear',
          icon: 'close',
          label: 'Clear filters',
          onSelect: clearFilters,
        },
      );
    }

    return items;
  }, filterRevision);

  const remove = (target: string): void => {
    const element = list.current;
    const rows = element === null ? [] : rowsOf(element);
    const row = rows.find((candidate) => idOf(candidate) === target);
    // A focus that was in the row goes to its neighbour once the row has left, never to the page.
    const had = row?.contains(document.activeElement) === true;
    const index = row === undefined ? 0 : rows.indexOf(row);
    if (store.remove(target).removed > 0 && had) {
      later.current = { kind: 'gone', id: target, index };
    }
  };

  const rows = useRows(list, remove);

  // After every draw: the focus a removal or "Show older" owed, once the draw that does it has been made.
  useLayoutEffect(() => {
    const owed = later.current;
    if (owed === null) {
      return;
    }

    const element = list.current;
    const present = (element === null ? [] : rowsOf(element)).some((row) => idOf(row) === owed.id);
    if (owed.kind === 'gone' ? present : !present) {
      return;
    }

    later.current = null;
    if (!rows.focus(owed.kind === 'shown' ? owed.id : undefined, owed.kind === 'gone' ? owed.index : 0) && owed.kind === 'gone') {
      root.current?.focus({ preventScroll: true });
    }
  });

  // Mounting is opening: the popover goes to the top layer, the focus goes into it (to the newest row, else to the popover), and the toast stack waits. Leaving closes it: the stack may come back, and the focus goes back to the
  // bell unless the person has already put it somewhere else.
  useLayoutEffect(() => {
    const element = root.current;
    const opener = invoker.current;
    if (element === null) {
      return undefined;
    }

    showPopover(element);
    focusInto(list.current, element);
    store.hold('center', true);
    return () => {
      store.hold('center', false);
      const active = element.ownerDocument.activeElement;
      if (opener !== null && (active === null || active === element.ownerDocument.body || element.contains(active))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [store, invoker]);

  // What it listed is the rows it drew; they are read when it closes (S81), counted from the moment each was listed.
  useEffect(() => {
    listed.current = view.shown;
  });
  useLayoutEffect(
    () => () => {
      markSeen(store, listed.current, openedAt);
    },
    [store, openedAt],
  );

  // The shared Filter popup lives inside this popover, so a press in it is not outside the centre.
  useEffect(() => {
    const element = root.current;
    const opener = invoker.current;
    if (element === null) {
      return undefined;
    }

    const press = (event: PointerEvent): void => {
      const at = event.target;
      if (at instanceof Node && (element.contains(at) || opener?.contains(at) === true)) {
        return;
      }

      centre.close();
    };

    document.addEventListener('pointerdown', press, true);
    return () => {
      document.removeEventListener('pointerdown', press, true);
    };
  }, [centre, invoker]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Escape closes the centre while the focus is in it (A3: a non-modal surface), and nothing else sees it: the shell's own Escape would take the focus to the page.
    if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      centre.close();
    }
  };

  const toggle = (target: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(target)) {
        next.add(target);
      }

      return next;
    });
    // Opening a row, or closing it, is acting on it (S81).
    store.read(target);
  };

  const run = (target: string, action: string, event: MouseEvent<HTMLButtonElement>): void => {
    const result = store.run(target, action, event);
    if (result.status === 'refused') {
      tell(result.message);
    }
  };

  const showMore = (): void => {
    const first = view.matched[view.shown.length];
    if (first !== undefined) {
      later.current = { kind: 'shown', id: first.id };
    }

    setMore(true);
  };

  const unmuteNote = (): void => {
    const [only] = muted;
    if (muted.length === 1 && only !== undefined) {
      if (store.unmute(only.source)) {
        tell(said.unmuted(only.name));
      }
    } else if (store.unmuteAll() > 0) {
      tell(said.unmutedAll);
    }
  };

  return (
    <div
      ref={root}
      id={id}
      popover="manual"
      role="dialog"
      aria-label="Notifications"
      tabIndex={-1}
      className={styles.centre}
      data-notices-part="centre"
      data-size="wide"
      style={{ '--_x': `${String(place.x)}px`, '--_bottom': `${String(place.bottom)}px`, '--_max': `${String(place.max)}px` }}
      onKeyDown={onKeyDown}
    >
      <div className={styles.header} data-notices-part="centreHeader">
        <h3 className={styles.heading} data-notices-part="centreTitle">
          Notifications
        </h3>
      </div>
      <div className={styles.body} data-notices-part="centreBody">
        <div className={styles.bar} data-notices-part="centreBar">
          <RovingGroup label="Notification actions" gap={8} align="center" data-notices-part="centreTools">
            <Button
              variant="ghost"
              size="compact"
              icon="check-check"
              disabledReason={counts.unread === 0 ? 'Everything is read' : undefined}
              data-notices-part="centreTool"
              onClick={() => {
                const unread = counts.unread;
                store.readAll();
                tell(said.readAll(unread));
              }}
            >
              Mark all as read
            </Button>
            {undo === undefined ? (
              <Button
                variant="ghost"
                size="compact"
                icon="trash"
                disabledReason={recent.length === 0 ? 'There is nothing finished to clear' : undefined}
                data-notices-part="centreTool"
                onClick={() => {
                  const cleared = store.clear();
                  if (cleared.removed > 0) {
                    tell(said.cleared(cleared.removed));
                  }
                }}
              >
                Clear finished
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="compact"
                icon="undo"
                data-notices-part="centreTool"
                onClick={() => {
                  if (store.undo()) {
                    tell(said.restored);
                  }
                }}
              >
                {undoLabel(undo.count)}
              </Button>
            )}
            <Button variant="ghost" size="compact" icon="list-filter" data-notices-part="filter" data-ov-menu-label="Filter notifications" data-ov-menu-pointer-focus="first" {...menuTrigger(menuId)}>
              Filter
            </Button>
          </RovingGroup>
          {source === '' ? null : (
            <div className={styles.note} data-notices-part="centreNote" data-note="filtered">
              <Icon name="list-filter" />
              <span className={styles.noteText} data-notices-part="centreNoteText">
                {name}
              </span>
              <Button variant="ghost" size="compact" data-notices-part="centreNoteButton" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}
          {note === undefined ? null : (
            <div className={styles.note} data-notices-part="centreNote" data-note="muted">
              <Icon name="bell-off" />
              <span className={styles.noteText} data-notices-part="centreNoteText">
                {note.text}
              </span>
              <Button variant="ghost" size="compact" data-notices-part="centreNoteButton" onClick={unmuteNote}>
                {note.button}
              </Button>
            </div>
          )}
        </div>
        <div className={styles.scroll} data-notices-part="centreScroll">
          {empty === undefined ? (
            <ul ref={list} className={styles.list} aria-label="Notifications" data-notices-part="centreList" onFocus={rows.onFocus} onKeyDown={rows.onKeyDown}>
              {view.items.map((item) =>
                item.kind === 'row' ? (
                  <li key={`row:${item.record.id}`} className={styles.item}>
                    <CentreRow record={item.record} expanded={expanded.has(item.record.id)} onToggle={toggle} onRemove={remove} onRun={run} />
                  </li>
                ) : (
                  <li key={item.key} className={styles.label}>
                    {item.kind === 'day' ? (
                      <DayHeading day={item.day} />
                    ) : (
                      <h4 className={styles.labelText} data-notices-part="centreLabel">
                        {item.text}
                      </h4>
                    )}
                  </li>
                ),
              )}
              {view.older === 0 ? null : (
                <li key="more" className={styles.more}>
                  <Button icon="chevron-down" data-notices-part="centreMore" onClick={showMore}>
                    {olderLabel(view.older)}
                  </Button>
                </li>
              )}
            </ul>
          ) : (
            <EmptyState
              data-notices-part="centreEmpty"
              icon={empty.icon}
              title={empty.title}
              hint={empty.hint}
              action={empty.action === 'clear-filters' ? { label: 'Clear filters', icon: 'close', onSelect: clearFilters } : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
