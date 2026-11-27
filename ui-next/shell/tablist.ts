import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { tablistKey } from './core/tablist';
import type { DragOut } from './core/tabs';
import { bindStripDrag } from './stripDrag';

// The one tab stop and the keys of a strip of tabs, for every strip of the shell: the tab strip of the top row and the panel's tool and session strips. `core/tablist.ts` holds the rule (what a
// key does); this holds the DOM that carries it out: which tab is the stop, where the focus goes, that the tab on screen is brought into view, that the wheel scrolls the strip sideways, that a tab closed from the
// keyboard hands the focus to its neighbour and one moved keeps the focus, and that the pointer drags a tab to another place (`stripDrag.ts`). A strip is a scroller whose direct children are the tabs' faces, each carrying `data-tab-id` (a face is the
// `role="tab"` button itself, or an element that holds it and its close control).

export type TablistOptions = {
  /** The tabs, in order, by the id each face carries in `data-tab-id`. */
  readonly ids: readonly string[];
  /** The tab on screen: the strip's tab stop while the focus is outside it, and the tab that is always revealed. */
  readonly selected: string | null;
  /** Delete or Backspace on a tab. It answers whether the tab closed: the focus then goes to its neighbour. Absent: the strip cannot close a tab from the keyboard. */
  readonly onClose?: ((id: string) => boolean) | undefined;
  /** The tab moves to an index of `ids`: Alt+Shift with an arrow, Home or End on a tab asks for it, and so does the pointer dropping one (`stripDrag.ts`), which says too, beside the separator of the pinned tabs, which side of it the drop is on (`pinned`). It answers whether the tab moved: the focus then stays on it. Absent: the strip can move a tab neither way. */
  readonly onMove?: ((id: string, to: number, pinned?: boolean) => boolean) | undefined;
  /** The pointer takes a tab out of the strip (`stripDrag.ts`: 18 px below it, or outside the window): asked for the tab's way out, which is told where the pointer goes and how the drag ends there, and the strip outlines the page as the place it goes to. Absent: the drag puts the tab back. */
  readonly onDragOut?: ((id: string) => DragOut) | undefined;
};

export type Tablist = {
  /** The strip's scroller. */
  readonly ref: RefObject<HTMLDivElement | null>;
  /** The tab that is the strip's one tab stop: the one the focus is on, else the tab on screen. */
  readonly stop: string | null;
  /** Puts the focus on a tab once the strip is drawn again: for a close that did not come from the keyboard, where the focus would otherwise fall to the page's body. */
  readonly focus: (id: string) => void;
  /** Spread on the strip's element. */
  readonly handlers: {
    readonly onFocus: (event: FocusEvent<HTMLDivElement>) => void;
    readonly onBlur: (event: FocusEvent<HTMLDivElement>) => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  };
};

/** The `role="tab"` element a DOM node is in, and the id its face carries. */
function tabOf(node: EventTarget | null): { readonly element: HTMLElement; readonly id: string } | undefined {
  const element = node instanceof Element ? node.closest<HTMLElement>('[role="tab"]') : null;
  const id = element?.dataset.tabId;
  return element !== null && id !== undefined ? { element, id } : undefined;
}

/** The face of a tab, found in the strip by its id. */
function faceOf(scroller: HTMLElement, id: string): HTMLElement | undefined {
  return [...scroller.children].find((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.tabId === id);
}

/** The tab button of a face: the face itself, or the button inside it. */
const buttonOf = (face: HTMLElement): HTMLElement | null => (face.matches('[role="tab"]') ? face : face.querySelector<HTMLElement>('[role="tab"]'));

/** Scrolls the strip just far enough that a face is whole in it (ch16 S53: the selected tab is always revealed). Nothing to do before layout, or when it already is. */
function reveal(scroller: HTMLElement, face: HTMLElement): void {
  const box = scroller.getBoundingClientRect();
  const at = face.getBoundingClientRect();
  if (box.width === 0) {
    return;
  }

  const delta = at.left < box.left ? at.left - box.left : at.right > box.right ? at.right - box.right : 0;
  if (Math.abs(delta) >= 0.5) {
    scroller.scrollLeft += delta;
  }
}

export function useTablist({ ids, selected, onClose, onMove, onDragOut }: TablistOptions): Tablist {
  // Where the focus is in the strip: the roving stop. Out of the strip, the stop is the tab on screen, so Tab and Shift+Tab always land on it.
  const [roving, setRoving] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const stop = roving !== null && ids.includes(roving) ? roving : selected;
  // The strip's scroller is drawn while there are tabs and not before (a strip of tools that a plugin brings starts with none): the listener below is bound again when it appears.
  const hasScroller = ids.length > 0;

  // A tab moved from the keyboard or dropped by the pointer: one callback for both, and a tab that moved keeps the focus once the strip is drawn in its new order.
  const move = (id: string, to: number, pinned?: boolean): void => {
    if (onMove?.(id, to, pinned) === true) {
      refocus.current = id;
    }
  };

  // The pointer's drag is bound to the scroller once and drops through this render's `move` and `onDragOut`, whichever render that is.
  const dropping = useRef({ move, onDragOut });
  useLayoutEffect(() => {
    dropping.current = { move, onDragOut };
  });

  // The tab on screen is revealed when it changes or the tabs do (a new tab opens after it, a close moves it).
  useLayoutEffect(() => {
    const element = ref.current;
    const face = element === null || selected === null ? undefined : faceOf(element, selected);
    if (element !== null && face !== undefined) {
      reveal(element, face);
    }
  }, [selected, ids]);

  // Scope can arrive after the selected tab is drawn. A narrower scroller must reveal that tab again without moving keyboard focus.
  useEffect(() => {
    const element = ref.current;
    if (element === null || !hasScroller || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      const target = element.querySelector<HTMLElement>('[role="tab"]:focus') ?? element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (target !== null) {
        reveal(element, target);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasScroller]);

  // A tab closed from the keyboard hands the focus to its neighbour, once the neighbour is there to take it.
  useEffect(() => {
    const element = ref.current;
    const id = refocus.current;
    if (element !== null && id !== null) {
      refocus.current = null;
      const face = faceOf(element, id);
      if (face !== undefined) {
        buttonOf(face)?.focus();
      }
    }
  });

  // The wheel scrolls the strip sideways, as it does a browser's tab bar. The listener is not passive, so it is bound to the scroller, not delegated, and to the scroller that is there: a strip
  // that had no tab when it mounted gets its scroller later (`hasScroller`).
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return undefined;
    }

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || element.scrollWidth <= element.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      element.scrollLeft += event.deltaY * unit * (getComputedStyle(element).direction === 'rtl' ? -1 : 1);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [hasScroller]);

  // The pointer drags a tab, in a strip that can move one (and take one out of the strip, where it has somewhere to): bound to the scroller that is there, as the wheel is.
  const draggable = onMove !== undefined;
  const leaving = onDragOut !== undefined;
  useEffect(() => {
    const element = ref.current;
    if (element === null || !draggable) {
      return undefined;
    }

    return bindStripDrag(element, (id, to, pinned) => {
      dropping.current.move(id, to, pinned);
    }, leaving ? (id) => dropping.current.onDragOut?.(id) : undefined);
  }, [hasScroller, draggable, leaving]);

  return {
    ref,
    stop,
    focus: (id) => {
      refocus.current = id;
    },
    handlers: {
      onFocus: (event) => {
        const hit = tabOf(event.target);
        if (hit !== undefined) {
          setRoving(hit.id);
        }
      },
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setRoving(null);
        }
      },
      onKeyDown: (event) => {
        const hit = tabOf(event.target);
        const moving = onMove !== undefined && event.altKey && event.shiftKey;
        if (hit === undefined || event.ctrlKey || event.metaKey || ((event.altKey || event.shiftKey) && !moving) || event.nativeEvent.isComposing) {
          return;
        }

        const at = ids.indexOf(hit.id);
        const answer = tablistKey(event.key, at, ids.length, getComputedStyle(event.currentTarget).direction === 'rtl', onClose !== undefined, moving);
        if (answer === undefined) {
          return;
        }

        event.preventDefault();
        if ('to' in answer) {
          const id = ids[answer.to];
          const face = id === undefined ? undefined : faceOf(event.currentTarget, id);
          if (face !== undefined) {
            buttonOf(face)?.focus({ preventScroll: true });
            reveal(event.currentTarget, face);
          }
        } else if ('move' in answer) {
          move(hit.id, answer.move);
        } else {
          const neighbour = ids[at + 1] ?? ids[at - 1];
          if (onClose?.(hit.id) === true && neighbour !== undefined) {
            refocus.current = neighbour;
          }
        }
      },
    },
  };
}
