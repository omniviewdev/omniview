import { useId, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type RefObject, type ClipboardEvent } from 'react';
import type { LogViewModel, ViewSnapshot } from '../../log/logViewModel';
import { LogRow } from './LogRow';
import styles from './LogView.module.css';

/**
 * Lets go of a text range the reader selected. A selection of LINES made now (all of them, or a range with Shift) is their newer choice, and a text range that stayed would win the copy, which
 * stands aside for one (`onCopy`).
 */
function letGoOfText(): void {
  window.getSelection()?.removeAllRanges();
}

type LogListProps = {
  readonly model: LogViewModel;
  readonly snapshot: ViewSnapshot;
  readonly label: string;
  /** The element that scrolls and holds the focus: the find bar's Escape and the strip's "Jump to latest" return to it. */
  readonly listRef: RefObject<HTMLDivElement | null>;
};

/**
 * The list of lines: one scroller that is one tab stop (the mock's `role="grid"` table with `tabindex=0`), windowed (HLT-1, MNR-L1): the rows in view and the
 * overscan are mounted, in normal flow in one block that is moved to the window's offset, inside a block as high as all the rows. One handler for each kind
 * of event, on the scroller, whatever the rows (T-07). Follow pins to the end after every commit that the model asked it to (HLT-9); nothing here decides
 * what follows: the model does, and the list reports what it measures and where it scrolls.
 */
export function LogList({ model, snapshot, label, listRef }: LogListProps) {
  const uid = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  // The last scroll command applied, with the model that issued it: each model numbers its commands from 1, so a number means something only with its owner.
  const applied = useRef<{ readonly model: LogViewModel; readonly id: number } | undefined>(undefined);

  // What the model needs to know of the geometry: the height a row has at this density and text size (read from the probe, as the table does), and the
  // height the rows scroll in. Read once before the first paint, then whenever either changes.
  useLayoutEffect(() => {
    const list = listRef.current;
    const header = headerRef.current;
    const probe = probeRef.current;
    if (list === null || header === null || probe === null) {
      return undefined;
    }

    const measure = () => {
      model.setRowHeight(probe.getBoundingClientRect().height);
      model.setViewport(Math.max(0, list.clientHeight - header.offsetHeight));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(probe);
    return () => {
      observer.disconnect();
    };
  }, [model, listRef]);

  // A scroll command from the model (pin to the end, show a match, stay on a line when the head goes) is applied once, after the commit that carries
  // it, and the place it landed is reported so the scroll event that follows is not taken for the reader (HLT-9: `scrollTop` written in a layout
  // effect, never `scrollToIndex`, whose retries fight new lines).
  useLayoutEffect(() => {
    const command = snapshot.scroll;
    const list = listRef.current;
    if (command === undefined || list === null) {
      return;
    }

    // The same model, a number it has applied or passed: a snapshot that carries an old command again (a new count, a new status) must not move the list. A
    // new model (another feed) starts again from its first command.
    const last = applied.current;
    if (last?.model === model && command.id <= last.id) {
      return;
    }

    applied.current = { model, id: command.id };
    const before = list.scrollTop;
    list.scrollTop = command.top === 'end' ? list.scrollHeight : command.top;
    // A write that leaves the offset where it was queues no scroll event, so there is none of the list's own to recognise: telling the model there is one would take the reader's
    // next scroll, if it landed within a few px of this place, for the list's (a buffer at its cap pins to the end it is already at, on every frame).
    if (list.scrollTop !== before) {
      model.applied(list.scrollTop);
    }
  }, [snapshot, model, listRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      letGoOfText();
      model.selectAll();
      return;
    }

    // Any other chord is the shell's (copy is the browser's: the list answers its `copy` event).
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const moves: Record<string, Parameters<LogViewModel['moveActive']>[0] | undefined> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: 'pageDown',
      PageUp: 'pageUp',
      Home: 'home',
      End: 'end',
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      if (event.shiftKey) {
        letGoOfText();
      }

      model.moveActive(move, event.shiftKey);
    }
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-n]') : null;
    // Only a row of this grid is a line: `data-*` passes through to the root of the view, so an ancestor of the list may carry a `data-n` that is its caller's.
    if (row !== null && row !== event.currentTarget && event.currentTarget.contains(row)) {
      model.select(Number(row.dataset.n), event.shiftKey);
    }
  };

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    // A press with Shift held asks the browser to extend a text selection from the last click to this one, and a copy then yields that selection and not the lines of the range
    // (the log's copy stands aside for a text selection): the press is the log's, and the focus the browser would have given the list is given here. A press without Shift is the
    // browser's, so a drag over the words of a row still selects them.
    if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      letGoOfText();
      event.currentTarget.focus({ preventScroll: true });
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    // Text the reader selected inside a row is the browser's to copy; with none, the selected lines are copied as plain text (HLT-18).
    if (window.getSelection()?.isCollapsed === false) {
      return;
    }

    const text = model.copyText();
    if (text !== undefined) {
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    }
  };

  const { start } = snapshot.window;
  const selection = snapshot.selection;
  const low = selection === undefined ? 0 : Math.min(selection.anchor, selection.focus);
  const high = selection === undefined ? -1 : Math.max(selection.anchor, selection.focus);
  const search = snapshot.search;
  const rows = [];
  let activeId: string | undefined;
  // The rows come from the snapshot: the model is never read here (T-10: the compiler caches a render on its inputs, and a read by index has none). A row's place is its index in
  // the list (the lines that are held and pass the filter) and one more for the header: it moves when the head goes, and the ordinal (the key, the id, the selection) does not.
  let position = start + 2;
  for (const { entry, hit } of snapshot.rows) {
    const id = `${uid}-${entry.n}`;
    if (selection?.focus === entry.n) {
      activeId = id;
    }

    rows.push(
      <LogRow
        key={entry.n}
        entry={entry}
        id={id}
        position={position}
        selected={entry.n >= low && entry.n <= high}
        current={hit && entry.n === search.current}
        pattern={hit ? (search.pattern ?? undefined) : undefined}
      />,
    );
    position += 1;
  }

  return (
    <div
      ref={listRef}
      className={styles.list}
      role="grid"
      tabIndex={0}
      aria-label={`Log lines, ${label}`}
      aria-rowcount={snapshot.count + 1}
      aria-colcount={3}
      aria-multiselectable="true"
      aria-activedescendant={activeId}
      onScroll={(event) => {
        const list = event.currentTarget;
        model.onScroll(list.scrollTop, { clientHeight: list.clientHeight, scrollHeight: list.scrollHeight });
      }}
      onWheel={(event) => {
        if (event.deltaY < 0) {
          model.followOff();
        }
      }}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onCopy={onCopy}
    >
      <div className={styles.canvas}>
        <div ref={headerRef} className={styles.header} role="row" aria-rowindex={1}>
          <span role="columnheader" className={styles.head} data-ov-column="time">
            Time
          </span>
          <span role="columnheader" className={styles.head} data-ov-column="level">
            Level
          </span>
          <span role="columnheader" className={styles.head} data-ov-column="message">
            Message
          </span>
        </div>
        {snapshot.count === 0 ? null : (
          <div className={styles.sizer} style={{ '--_count': snapshot.count }}>
            <div className={styles.window} style={{ '--_start': start }}>
              {rows}
            </div>
          </div>
        )}
      </div>
      <div ref={probeRef} className={styles.probe} aria-hidden="true" />
    </div>
  );
}
