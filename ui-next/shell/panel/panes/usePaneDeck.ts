import { useEffect, useRef, useState, type RefObject } from 'react';
import { PANE_MIN_PX, type PaneLayout, type ToolId } from '../../core/panel';
import { usePanel } from '../context';
import { extentOf, SASH_PX } from './geometry';
import type { PaneRoom } from './room';

/**
 * The deck of a tool that has panes: what follows its length. When the deck changes size (the window, the panel's maximise, a sidebar) the shares are brought within the minimum of the length it has now (`fitPanes`, which changes
 * nothing when they fit: the model returns the same state, so nobody is told), and the room for one more pane is kept for the toolbar of each body (`PaneRoom`). It runs on the observer's own callback, once a frame at most, and
 * writes no style: a drag of the panel's splitter changes its height, which is not the axis of a row of panes and is not measured here.
 */
export function usePaneDeck(deck: RefObject<HTMLElement | null>, tool: ToolId | null, layout: PaneLayout | null): PaneRoom {
  const { store } = usePanel();
  // The deck's length along its axis as the observer last saw it. Unknown (before the first observation, or where there is no observer) is room enough: the button is not disabled for a length nobody has measured.
  const [length, setLength] = useState(Number.POSITIVE_INFINITY);
  const count = layout?.panes.length ?? 1;
  const axis = layout?.axis ?? 'row';
  const grouped = tool !== null && count > 1;
  // What the observer's callback reads is kept here, so that the observer is made once for a deck and not again for each change of the layout.
  const latest = useRef({ tool, count, axis, grouped });
  useEffect(() => {
    latest.current = { tool, count, axis, grouped };
  });

  useEffect(() => {
    const element = deck.current;
    if (element === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observe = (): void => {
      const { tool: id, count: panes, axis: along, grouped: several } = latest.current;
      setLength(along === 'row' ? element.clientWidth : element.clientHeight);
      const extent = extentOf(element, along, panes);
      if (several && id !== null && extent > 0) {
        store.fitPanes(id, extent);
      }
    };

    const observer = new ResizeObserver(observe);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [deck, store]);

  // A change of the number of panes or of the axis is a new length for the panes: the shares are fitted to it.
  useEffect(() => {
    const element = deck.current;
    if (element === null || !grouped) {
      return;
    }

    const extent = extentOf(element, axis, count);
    if (extent > 0) {
      store.fitPanes(tool, extent);
    }
  }, [deck, store, tool, count, axis, grouped]);

  return {
    fits: (count + 1) * PANE_MIN_PX <= length - count * SASH_PX,
    extent: () => (deck.current === null ? 0 : extentOf(deck.current, axis, count + 1)),
  };
}
