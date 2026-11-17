import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import type { RowMenuHandle, RowMenuState } from './handle';
import { place, type Placement } from './placement';
import styles from './RowMenu.module.css';

/** One action of the menu, for one row. Built only for the menu that is open, from the row that opened it. */
export type RowMenuItem<TRow> = {
  /** Names the item among its siblings; stable across renders. */
  readonly id: string;
  /** What the item says, in sentence case, with an ellipsis only when it asks for more before it acts ("Delete\u2026"). It is the item's accessible name. */
  readonly label: string;
  /** Called with the row the menu was opened for, once the menu has closed and focus is back on the trigger: a dialog or a field it opens keeps focus. */
  readonly onSelect: (row: TRow) => void;
  /** The item cannot apply to this row. It stays in the menu, announced as unavailable (`aria-disabled`), is skipped by the arrow keys and does nothing. */
  readonly disabled?: boolean | undefined;
  /** The item destroys something: drawn in the error colour and described as a destructive action, so colour is not the only signal. */
  readonly destructive?: boolean | undefined;
  /** A separator is drawn before the item, to set a group apart; before the first item it draws nothing. */
  readonly separatorBefore?: boolean | undefined;
};

export type RowMenuProps<TRow> = {
  /** The table's handle (`createRowMenu`): the same one its triggers were given. */
  readonly handle: RowMenuHandle<TRow>;
  /** The accessible name of the menu ("Job actions"). */
  readonly label: string;
  /** The items of the menu for a row. Called only while the menu is open, with the row that opened it, and again when this part renders again. A menu with no items closes. */
  readonly items: (row: TRow) => ReadonlyArray<RowMenuItem<TRow>>;
} & DataAttributes;

/** An item the arrow keys, Home, End and the pointer can reach: an unavailable one is announced but never a stop. */
const AVAILABLE = '[role="menuitem"]:not([aria-disabled="true"])';

/** Moves focus among the available items: down and up wrap round, Home and End go to the ends; from the popup itself (no item active) down is the first and up the last. */
function move(popup: HTMLElement, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End') {
  const available = [...popup.querySelectorAll<HTMLElement>(AVAILABLE)];
  if (available.length === 0) {
    return;
  }

  const at = available.findIndex((item) => item === popup.ownerDocument.activeElement);
  let next = available.length - 1;
  if (key === 'ArrowDown') {
    next = at < 0 ? 0 : (at + 1) % available.length;
  } else if (key === 'ArrowUp') {
    next = at < 0 ? available.length - 1 : (at - 1 + available.length) % available.length;
  } else if (key === 'Home') {
    next = 0;
  }

  available.at(next)?.focus();
}

type PopupProps<TRow> = {
  readonly handle: RowMenuHandle<TRow>;
  readonly state: Extract<RowMenuState<TRow>, { readonly open: true }>;
  readonly label: string;
  readonly items: (row: TRow) => ReadonlyArray<RowMenuItem<TRow>>;
  readonly data: DataAttributes;
};

/** One opening of the menu: mounted when it opens (keyed by the opening), unmounted when it closes. */
function Popup<TRow>({ handle, state, label, items, data }: PopupProps<TRow>) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);
  const entries = useMemo(() => items(state.row), [items, state.row]);
  const empty = entries.length === 0;

  // A menu with nothing to offer for this row is not shown, and closes.
  useLayoutEffect(() => {
    if (empty) {
      handle.close();
    }
  }, [empty, handle]);

  // Once, before the first paint: into the top layer (where the engine has one, so no ancestor clips the popup or stacks above it), then
  // measured and placed from the trigger's rectangle and its own size. Nothing measures again until the next opening.
  useLayoutEffect(() => {
    const popup = ref.current;
    if (popup === null) {
      return;
    }

    if (typeof popup.showPopover === 'function') {
      popup.showPopover();
    }

    const anchor = state.anchor.getBoundingClientRect();
    const size = popup.getBoundingClientRect();
    const viewport = popup.ownerDocument.documentElement;
    setPlacement(
      place(
        anchor,
        { width: Math.ceil(size.width), height: Math.ceil(size.height) },
        { width: viewport.clientWidth, height: viewport.clientHeight },
        getComputedStyle(state.anchor).direction === 'rtl',
      ),
    );
  }, [state.anchor]);

  // Focus goes in once the popup is where it will stay: the first or last available item for a key, the popup itself for a pointer.
  useLayoutEffect(() => {
    const popup = ref.current;
    if (placement === undefined || popup === null) {
      return;
    }

    const available = popup.querySelectorAll<HTMLElement>(AVAILABLE);
    const target = state.focus === 'first' ? available.item(0) : state.focus === 'last' ? available.item(available.length - 1) : null;
    (target ?? popup).focus({ preventScroll: true });
  }, [placement, state.focus]);

  if (empty) {
    return null;
  }

  return (
    <div
      {...dataAttributes(data)}
      ref={ref}
      id={handle.id}
      className={styles.root}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      popover="manual"
      data-ov-side={placement?.side}
      style={{
        '--_x': placement === undefined ? undefined : `${placement.left}px`,
        '--_y': placement === undefined ? undefined : `${placement.top}px`,
        '--_max-height': placement?.maxHeight === undefined ? undefined : `${placement.maxHeight}px`,
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }

        if (event.key === 'Escape') {
          // The menu's alone: a dialog or a drawer around the table does not also close on this press.
          event.preventDefault();
          event.stopPropagation();
          handle.close();
        } else if (event.key === 'Tab') {
          // Focus goes back to the trigger first, so that the browser's Tab goes on from there (to the next stop, or the previous with Shift).
          handle.close();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          move(event.currentTarget, event.key);
        }
      }}
      onPointerMove={(event) => {
        // One fill for the pointer and the keyboard: the item under the pointer is the focused item.
        const item = event.pointerType !== 'touch' && event.target instanceof Element ? event.target.closest<HTMLElement>(AVAILABLE) : null;
        if (item !== null && item !== event.currentTarget.ownerDocument.activeElement) {
          item.focus({ preventScroll: true });
        }
      }}
      onMouseDown={(event) => {
        // A press on the padding or a separator must not take focus out of the menu: that would close it.
        event.preventDefault();
      }}
      onBlur={(event) => {
        // Focus left the menu for another control, or the window lost it: the menu closes, and focus stays where it went. Its own trigger is
        // not another control: a press on it moves focus there (Chromium does, on the press) before the click that toggles the menu closed.
        const next = event.relatedTarget;
        if (!(next instanceof Node && (event.currentTarget.contains(next) || state.anchor.contains(next)))) {
          handle.close({ restoreFocus: false });
        }
      }}
    >
      {entries.map((entry, index) => (
        <Fragment key={entry.id}>
          {entry.separatorBefore === true && index > 0 ? <div role="separator" className={styles.separator} /> : null}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.item}
            data-ov-destructive={entry.destructive === true ? '' : undefined}
            aria-disabled={entry.disabled === true ? 'true' : undefined}
            aria-description={entry.destructive === true ? 'Destructive action' : undefined}
            onClick={() => {
              if (entry.disabled !== true) {
                // Closed first, with focus back on the trigger: what the action does with focus (a dialog, a field) then stands.
                handle.close();
                entry.onSelect(state.row);
              }
            }}
          >
            {entry.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The one popup of a table's row menu: mount it once, beside the table, with the table's handle. Closed it renders nothing (no element);
 * open it renders exactly one popup root (`role="menu"`) however many rows the table has, in the top layer where the engine has one, placed
 * once from the trigger's rectangle and its own measured size: below the trigger, end-aligned to it, above when it does not fit below, 4 px
 * inside the window. Its items are built only while it is open, from the row that opened it.
 *
 * Keys: Enter, Space or ArrowDown on a trigger opens it on the first item and ArrowUp on the last; ArrowUp, ArrowDown, Home and End move
 * (the arrow keys wrap, and skip an unavailable item); Escape closes it and returns focus to the trigger; Tab closes it and goes on from the
 * trigger; a press outside closes it. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function RowMenu<TRow>({ handle, label, items, ...rest }: RowMenuProps<TRow>): ReactElement | null {
  const state = useSyncExternalStore(handle.subscribe, handle.getSnapshot, handle.getSnapshot);
  // The part going away takes an open menu with it: its listeners and the trigger's attributes must not outlive it.
  useEffect(
    () => () => {
      handle.close({ restoreFocus: false });
    },
    [handle],
  );

  return state.open ? <Popup key={state.epoch} handle={handle} state={state} label={label} items={items} data={rest} /> : null;
}
