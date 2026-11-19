import { Icon, tip } from '@omniviewdev/kit';
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { TabId } from '../core/tabs';
import { useTabs } from './context';
import { useActiveId, useTabIds } from './hooks';
import { Tab } from './Tab';
import styles from './TabStrip.module.css';

type TabStripProps = {
  readonly prefix: string;
  readonly panelId: string;
  /** What the new-tab control does. Absent: the strip has none. The mock's control opens a menu (ch16 S34); until the menu exists the host answers it with a plain new tab. */
  readonly onNewTab: (() => void) | undefined;
};

/** The tab button a DOM node is in, and the id of the tab it stands for. */
function tabOf(node: EventTarget | null): { readonly element: HTMLElement; readonly id: TabId } | undefined {
  const element = node instanceof Element ? node.closest<HTMLElement>('[role="tab"]') : null;
  const id = element?.dataset.tabId;
  return element !== null && id !== undefined ? { element, id } : undefined;
}

/** The face of a tab, found in the strip by its id. */
function faceOf(scroller: HTMLElement, id: TabId): HTMLElement | undefined {
  return [...scroller.children].find((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.tabId === id);
}

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

/**
 * The strip of the top row (ch16 S4, S53, S54): the tabs in one scroller, then the new-tab control. The faces share the strip's width equally, 208 px at most, and give way together
 * down to 96 px before the scroller scrolls; the wheel scrolls it sideways and the tab on screen is always brought into view. It is a roving tablist with one tab stop: the arrows
 * move the focus and never load a page, Home and End jump, Enter and Space select, Delete closes and puts the focus on the neighbour. It reads the order and the tab on screen and
 * nothing else: each `Tab` reads its own slice, so a change in one tab does not render the strip. Kit part it should become: TabStrip.
 */
export function TabStrip({ prefix, panelId, onNewTab }: TabStripProps) {
  const store = useTabs();
  const ids = useTabIds(store);
  const active = useActiveId(store);
  // Where the focus is in the strip: the roving stop. Out of the strip, the stop is the tab on screen, so Tab and Shift+Tab always land on it.
  const [roving, setRoving] = useState<TabId | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const refocus = useRef<TabId | null>(null);
  const stop = roving !== null && ids.includes(roving) ? roving : active;

  // The tab on screen is revealed when it changes or the tabs do (a new tab opens after it, a close moves it).
  useLayoutEffect(() => {
    const element = scroller.current;
    const face = element === null || active === null ? undefined : faceOf(element, active);
    if (element !== null && face !== undefined) {
      reveal(element, face);
    }
  }, [active, ids]);

  // A tab closed from the keyboard hands the focus to its neighbour, once the neighbour is there to take it.
  useEffect(() => {
    const element = scroller.current;
    const id = refocus.current;
    if (element !== null && id !== null) {
      refocus.current = null;
      faceOf(element, id)?.querySelector<HTMLElement>('[role="tab"]')?.focus();
    }
  });

  // The wheel scrolls the strip sideways, as it does a browser's tab bar. The listener is not passive, so it is bound to the scroller, not delegated.
  useEffect(() => {
    const element = scroller.current;
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
  }, []);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const hit = tabOf(event.target);
    if (hit !== undefined) {
      setRoving(hit.id);
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setRoving(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const hit = tabOf(event.target);
    if (hit === undefined || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    const at = ids.indexOf(hit.id);
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const focusAt = (index: number) => {
      const id = ids[(index + ids.length) % ids.length];
      const face = id === undefined ? undefined : faceOf(event.currentTarget, id);
      face?.querySelector<HTMLElement>('[role="tab"]')?.focus({ preventScroll: true });
      if (face !== undefined) {
        reveal(event.currentTarget, face);
      }
    };

    // Arrows only move the focus and wrap; they never load a page. Enter and Space are the button's own click.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      focusAt(at + (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusAt(event.key === 'Home' ? 0 : ids.length - 1);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const neighbour = ids[at + 1] ?? ids[at - 1];
      if (store.close(hit.id).status === 'done' && neighbour !== undefined) {
        refocus.current = neighbour;
      }
    }
  };

  return (
    <div className={styles.strip} data-shell-part="tabStrip">
      <div
        ref={scroller}
        className={styles.scroller}
        role={ids.length === 0 ? undefined : 'tablist'}
        aria-label={ids.length === 0 ? undefined : 'Open tabs'}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {ids.map((id) => (
          <Tab key={id} id={id} stop={id === stop} active={id === active} prefix={prefix} panelId={panelId} />
        ))}
      </div>
      {onNewTab === undefined ? null : (
        <button type="button" className={styles.new} aria-label="New tab" {...tip('New tab')} onClick={onNewTab}>
          <Icon name="plus" />
        </button>
      )}
    </div>
  );
}
