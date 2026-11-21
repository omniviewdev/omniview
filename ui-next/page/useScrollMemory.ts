import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from 'react';
import { keepScroll, keptScroll, type Scroll } from './kept';
import type { PageMemory } from './memory';

/** How long after the last scroll event the position is written down: the scrolling has stopped. */
export const SCROLL_SETTLE_MS = 150;

export type ScrollMemory = {
  /** On the element that holds the page, to hear every scroll inside it (a scroll event does not bubble). */
  readonly onScrollCapture: (event: UIEvent<HTMLElement>) => void;
  /** Writes the position now, if the table was scrolled and it is not written yet: for a press or a key that may take the page away before the scrolling is known to have stopped. */
  readonly flush: () => void;
};

type ScrollMemoryOptions = {
  /** The element that holds the page: the table's region is looked for inside it. The page puts the ref on it. */
  readonly root: RefObject<HTMLElement | null>;
  readonly memory: PageMemory | undefined;
  /** What the host held when the page was drawn: where the table was left. */
  readonly opened: unknown;
  /** The name of the table's scroll region: the list's title. */
  readonly label: string;
  /** The list has everything it will show: a position it cannot reach now it never will, and is put back as far as it goes. */
  readonly settled: boolean;
};

const regionOf = (root: Element | null, label: string): HTMLElement | null =>
  root === null ? null : ([...root.querySelectorAll<HTMLElement>('[role="region"]')].find((element) => element.getAttribute('aria-label') === label) ?? null);

/**
 * Where the list's table is scrolled, kept for the host to give back (H7: Back, Forward, a reload, a page the keep-alive cap let go). The kit's table takes no offset and says none, so this reads the one thing
 * it has: its named scroll region (`role="region"`, named by the list's title), as the page host does for every scroller.
 *
 * WRITING: the position is written once the scrolling has stopped (`SCROLL_SETTLE_MS`), or at once when the person presses on the page or a key, because that may be what takes the page away. It is never written
 * on mount, never for a scroll of anything but the table, and never when the page goes: by then the tab has moved on, and a write would be the next page's.
 *
 * READING: as the page opens, the table is put back where the host says it was left, as soon as the table can reach that place: while the list loads or its rows are still coming there is nothing to scroll, so it
 * waits, and it puts the table back as far as it goes once the list is complete. A table that is already scrolled, because the person did it, is theirs and is left alone.
 */
export function useScrollMemory({ root, memory, opened, label, settled }: ScrollMemoryOptions): ScrollMemory {
  const [wanted] = useState(() => keptScroll(opened));
  // Where the table is to be put back: nothing once it is there, once the person scrolled it, or once the list is complete and it was put back as far as it goes.
  const pending = useRef<Scroll | undefined>(wanted);
  // The position the table was last seen at and has not been written, and the timer that writes it.
  const latest = useRef<Scroll | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // After every render until it has put the table back: the rows, and so the room to scroll, arrive with a render of the page.
  useLayoutEffect(() => {
    const target = pending.current;
    const region = target === undefined ? null : regionOf(root.current, label);
    if (target === undefined || region === null) {
      return;
    }

    if (region.scrollTop !== 0 || region.scrollLeft !== 0) {
      pending.current = undefined;
      return;
    }

    const farthest = { top: Math.max(0, region.scrollHeight - region.clientHeight), left: Math.max(0, region.scrollWidth - region.clientWidth) };
    if ((target.top <= farthest.top && target.left <= farthest.left) || settled) {
      region.scrollTop = Math.min(target.top, farthest.top);
      region.scrollLeft = Math.min(target.left, farthest.left);
      pending.current = undefined;
    }
  });

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const position = latest.current;
    latest.current = undefined;
    if (position !== undefined && memory !== undefined) {
      memory.write(keepScroll(memory.read(), position));
    }
  };

  const onScrollCapture = (event: UIEvent<HTMLElement>) => {
    const { target } = event;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'region' || target.getAttribute('aria-label') !== label) {
      return;
    }

    const position = { top: Math.round(target.scrollTop), left: Math.round(target.scrollLeft) };
    if (pending.current !== undefined) {
      // Not put back yet, so the table is at its start, which is not where the page was left and is not to be written over it. Anywhere else is the person's, and theirs wins.
      if (position.top === 0 && position.left === 0) {
        return;
      }

      pending.current = undefined;
    }

    latest.current = position;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SCROLL_SETTLE_MS);
  };

  return { onScrollCapture, flush };
}
