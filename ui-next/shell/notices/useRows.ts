import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { applyStop, focusRow, idOf, rowOf, rowsOf } from './centreDom';

// The keyboard of the centre's list (ch16 S80, ch04 §5; the mock's `H.notification.list`, shell-notify.js, "one tab stop for the whole list"): the list is ONE stop. The current row's controls are in the tab order and no
// other row's are; Tab goes through the current row's own controls (its title, its buttons) and leaves the list; the arrows, Home and End move between rows, and Delete removes the row. It acts on the DOM the rows drew, as
// the kit's roving group does, so a row that comes or goes needs no state of its own: after every draw exactly one row is the stop, and it stays the row that last had the focus for as long as that row is listed.

export type Rows = {
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Gives the focus to the row with this id; when it is not listed, to the row at `index` (the last when it is past the end). `false` when there is no row to give it to. */
  readonly focus: (id: string | undefined, index: number) => boolean;
};

/** Where an arrow, Home or End goes from row `at` of `count`: nowhere past an end. */
function target(key: string, at: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, at + 1);
    case 'ArrowUp':
      return Math.max(0, at - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

export function useRows(list: RefObject<HTMLElement | null>, onRemove: (id: string) => void): Rows {
  /** The id of the row that is the stop. */
  const current = useRef('');

  // After every draw: the stop is the row that last had the focus while it is listed, else the first.
  useLayoutEffect(() => {
    const element = list.current;
    const rows = element === null ? [] : rowsOf(element);
    const [first] = rows;
    if (first === undefined) {
      return;
    }

    if (!rows.some((row) => idOf(row) === current.current)) {
      current.current = idOf(first);
    }

    applyStop(rows, current.current);
  });

  return {
    onFocus: (event) => {
      const row = rowOf(event.target);
      if (row !== null) {
        current.current = idOf(row);
        applyStop(rowsOf(event.currentTarget), current.current);
      }
    },
    onKeyDown: (event) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const row = rowOf(event.target);
      if (row === null) {
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        onRemove(idOf(row));
        return;
      }

      const rows = rowsOf(event.currentTarget);
      const to = target(event.key, rows.indexOf(row), rows.length);
      if (to !== undefined) {
        // A key of the list's even at an end, where nothing moves.
        event.preventDefault();
        focusRow(rows[to]);
      }
    },
    focus: (id, index) => {
      const element = list.current;
      const rows = element === null ? [] : rowsOf(element);
      const found = id === undefined ? undefined : rows.find((row) => idOf(row) === id);
      return focusRow(found ?? rows[Math.min(Math.max(index, 0), rows.length - 1)]);
    },
  };
}
