/**
 * The handle of a table's row menu: the one owner of whether the menu is open, for which row, and from which trigger.
 *
 * A table has one handle (`createRowMenu`), one popup (`RowMenu`, mounted once beside the table) and a trigger in each row
 * (`RowMenuTrigger`). The triggers hold no state and read nothing: a click hands the trigger's element and its row to the handle, the
 * popup draws what the handle says, and the handle alone writes `aria-expanded` and `aria-controls` on the one trigger that is open. So a
 * table of 5,025 rows has one popup root and the same few listeners as a table of 60 (docs/ui-next/optimisations.md T-08, MNR-T6; the old
 * host's `Menu.createHandle`, host #470).
 *
 * While a menu is open the handle holds exactly three listeners on the window (a press, a scroll and a resize) and one MutationObserver on
 * the document; when it closes, for any reason, it holds nothing:
 *
 *   a press outside the menu and its trigger   closes it, and returns focus first: the press then moves focus to what was pressed
 *   a scroll of anything that holds the trigger,
 *   or of the page, and a resize               close it: it is placed once, when it opens, and never follows the trigger (the old menu did
 *                                              the same, `ActionMenuScope`)
 *   the trigger leaving the document           closes it and moves focus to the nearest focusable ancestor of the trigger, the table region
 *                                              (a virtual row left the window, or its record was deleted), else to the body
 *   focus dropped on the body                  while it is open (the focused item was removed, or the popup was moved, in an engine that
 *                                              sends no blur for either) puts focus back on the popup, so Escape and Tab still reach it
 *
 * Focus goes back to the trigger only when it is in the menu or nowhere: a user who moved on keeps what they chose.
 */

/** Which item takes focus when a menu opens: the first available one, the last, or the menu itself (a pointer opened it: no item is active until the user moves). */
export type RowMenuFocus = 'first' | 'last' | 'menu';

/** What a handle holds: closed, or open for one row from one trigger. `epoch` is a number that is new for every opening. */
export type RowMenuState<TRow> =
  | { readonly open: false }
  | { readonly open: true; readonly row: TRow; readonly anchor: HTMLElement; readonly focus: RowMenuFocus; readonly epoch: number };

/** The handle of one table's row menu: what a trigger and the popup share. `open`, `toggle` and `close` are what a trigger (or a keyboard shortcut of the page) calls; `subscribe` and `getSnapshot` are the shape `useSyncExternalStore` takes, so the page can also follow the menu (to hold back a tooltip while it is open, say). */
export type RowMenuHandle<TRow> = {
  /** The id of the popup, which is what `aria-controls` of the open trigger points at. */
  readonly id: string;
  /** Opens the menu for `row` from `anchor`, the trigger's element (closing it first when it is open for another). `focus` defaults to the first available item. */
  readonly open: (anchor: HTMLElement, row: TRow, focus?: RowMenuFocus) => void;
  /** What a trigger does on a click: closes the menu when it is open from `anchor`, else opens it for `row` from there. */
  readonly toggle: (anchor: HTMLElement, row: TRow, focus?: RowMenuFocus) => void;
  /** Closes the menu. Focus goes back to the trigger unless `restoreFocus` is false, or focus is already somewhere else the user chose. Closing a closed menu does nothing. */
  readonly close: (options?: { readonly restoreFocus?: boolean | undefined }) => void;
  /** For `useSyncExternalStore`: `listener` is called after every change of state. Returns the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The state: the same object until it changes. */
  readonly getSnapshot: () => RowMenuState<TRow>;
};

let handles = 0;

/** What exists while a menu is open: its trigger, the region to fall back to, and what undoes the listeners and the observer. */
type Session = { readonly anchor: HTMLElement; readonly region: HTMLElement | null; readonly stop: () => void };

/** Creates the handle of one table. Make one for each table (not one for every table of its kind): two tables with one handle would draw two popups. */
export function createRowMenu<TRow>(): RowMenuHandle<TRow> {
  handles += 1;
  const id = `ov-row-menu-${handles}`;
  const listeners = new Set<() => void>();
  let state: RowMenuState<TRow> = { open: false };
  let session: Session | undefined;
  let epoch = 0;

  const publish = (next: RowMenuState<TRow>) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  /** Where focus goes when the menu closes: the trigger, else the table region; else nowhere, and it leaves the popup now rather than when the popup is removed. */
  const restoreFocus = (anchor: HTMLElement, region: HTMLElement | null) => {
    const doc = anchor.ownerDocument;
    if (anchor.isConnected) {
      anchor.focus({ preventScroll: true });
      if (doc.activeElement === anchor) {
        return;
      }
    }

    if (region?.isConnected === true) {
      region.focus({ preventScroll: true });
      return;
    }

    const active = doc.activeElement;
    if (active instanceof HTMLElement && doc.getElementById(id)?.contains(active) === true) {
      active.blur();
    }
  };

  const close = (options?: { readonly restoreFocus?: boolean | undefined }) => {
    const ending = session;
    if (ending === undefined) {
      return;
    }

    session = undefined;
    ending.stop();
    const { anchor, region } = ending;
    const doc = anchor.ownerDocument;
    const active = doc.activeElement;
    // Focus is the menu's to give back only while it is in the menu or nowhere; an element the user went to keeps it.
    const holdsFocus = active === null || active === doc.body || doc.getElementById(id)?.contains(active) === true;
    anchor.removeAttribute('aria-expanded');
    anchor.removeAttribute('aria-controls');
    if (options?.restoreFocus !== false && holdsFocus) {
      restoreFocus(anchor, region);
    }

    publish({ open: false });
  };

  /** The three listeners and the observer of an open menu, and the region the trigger sits in, found now while the trigger is in the document. */
  const begin = (anchor: HTMLElement): Session => {
    const doc = anchor.ownerDocument;
    const win = doc.defaultView;
    const region = anchor.parentElement?.closest<HTMLElement>('[tabindex]') ?? null;
    if (win === null) {
      return { anchor, region, stop: () => undefined };
    }

    const inPopup = (target: EventTarget | null) => target instanceof Node && doc.getElementById(id)?.contains(target) === true;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && anchor.contains(target)) {
        // The trigger's own click toggles the menu.
        return;
      }

      if (!inPopup(target)) {
        close();
      }
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      if (inPopup(target)) {
        return;
      }

      // The window itself is the one scroll target that is not a node; the document is the page's own scroll.
      if (!(target instanceof Node) || target === doc || target.contains(anchor)) {
        close();
      }
    };

    const onResize = () => {
      close();
    };

    const observer = new MutationObserver(() => {
      if (!anchor.isConnected) {
        close();
        return;
      }

      // An engine that sends no blur when the focused node leaves the page (WebKit) leaves focus on the body while the menu is open: no
      // key reaches the menu, and Escape and Tab would close nothing. Focus goes back to the menu, where the person is. A blur that was sent
      // (Chromium's) already closed the menu or moved focus to another control, and then there is nothing here to take back.
      const active = doc.activeElement;
      if (active === null || active === doc.body) {
        doc.getElementById(id)?.focus({ preventScroll: true });
      }
    });

    win.addEventListener('pointerdown', onPointerDown, true);
    win.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', onResize);
    observer.observe(doc, { childList: true, subtree: true });
    return {
      anchor,
      region,
      stop: () => {
        win.removeEventListener('pointerdown', onPointerDown, true);
        win.removeEventListener('scroll', onScroll, true);
        win.removeEventListener('resize', onResize);
        observer.disconnect();
      },
    };
  };

  const open = (anchor: HTMLElement, row: TRow, focus: RowMenuFocus = 'first') => {
    if (session !== undefined) {
      const previous = session;
      session = undefined;
      previous.stop();
      previous.anchor.removeAttribute('aria-expanded');
      previous.anchor.removeAttribute('aria-controls');
    }

    session = begin(anchor);
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', id);
    epoch += 1;
    publish({ open: true, row, anchor, focus, epoch });
  };

  const toggle = (anchor: HTMLElement, row: TRow, focus?: RowMenuFocus) => {
    if (state.open && state.anchor === anchor) {
      close();
    } else {
      open(anchor, row, focus);
    }
  };

  return {
    id,
    open,
    toggle,
    close,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
  };
}
