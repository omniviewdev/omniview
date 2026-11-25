import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { useVirtualRows, type VirtualRow } from '../../table/useVirtualRows';
import { heightOf, useMeasure } from '../DataTable/useMeasure';
import { Icon } from '../Icon';
import { MARGIN, placeMenu, type MenuPlacement } from '../Menu/placement';
import { OptionRow } from './OptionRow';
import type { ValuePickerOption } from './ValuePicker';
import styles from './ValuePicker.module.css';

/** The popup is at least this wide, in px (the mock's `min-width: max(280px, …)`), and as wide as its trigger when that is wider. */
const MIN_WIDTH = 280;
/** Rows mounted beyond the viewport on each side: the table's measured value. */
const OVERSCAN = 8;
/** What a row is until the probe has been measured: the row tokens at 100% text size, for one line and for two. */
const ONE_LINE = 24;
const TWO_LINES = 40;
/** The rows that stand for the window while the list has no size: more than the 242 px of the list holds, at the least row height. */
const FIRST_SCREEN = 20;

type Placed = MenuPlacement & { readonly width: number };

/** Why an option cannot be chosen: its reason, when it has one. An empty reason is no reason, as everywhere in the kit. */
function reasonOf(option: ValuePickerOption | undefined): string | undefined {
  const reason = option?.disabledReason;
  return reason === undefined || reason.trim() === '' ? undefined : reason;
}

/** The row of the first option that is chosen, for the list to open on; the all row, when there is one, is row 0. */
function firstChosen(options: readonly ValuePickerOption[], value: readonly string[], hasAll: boolean): number | undefined {
  if (value.length === 0) {
    return undefined;
  }

  const chosen = new Set(value);
  const index = options.findIndex((option) => chosen.has(option.value));
  return index < 0 ? undefined : index + (hasAll ? 1 : 0);
}

/** The row the list is on while nothing was moved to: the first that can be chosen. */
function firstEnabled(visible: readonly ValuePickerOption[], offset: number): number {
  if (offset > 0) {
    return 0;
  }

  const index = visible.findIndex((option) => reasonOf(option) === undefined);
  return index < 0 ? 0 : index;
}

/** The row an event came from: the list has one handler for every row, and a row says its place. */
function rowAt(target: EventTarget): number | undefined {
  const row = target instanceof Element ? target.closest('[role="option"]') : null;
  const index = row === null ? Number.NaN : Number(row.getAttribute('data-ov-index'));
  return Number.isInteger(index) ? index : undefined;
}

type PopupProps = {
  /** The trigger: the popup is placed against it and the focus goes back to it. */
  readonly anchor: RefObject<HTMLButtonElement | null>;
  readonly listId: string;
  /** The accessible name of the list, and with "Search " of the field. */
  readonly name: string;
  readonly options: readonly ValuePickerOption[];
  readonly value: readonly string[];
  readonly onValueChange: (value: readonly string[]) => void;
  readonly allOption: string | undefined;
  readonly searchable: boolean;
  /** Asks the picker to close. With `true` the focus goes back to the trigger first. */
  readonly onClose: (restoreFocus: boolean) => void;
};

/**
 * The open popup of a value picker: a search field and a list of the options, mounted only while it is open. The focus stays in the field (in
 * the list when there is no field) and the active row is the field's `aria-activedescendant`, so the keys move through the list while the text
 * is typed. The list is windowed (the table's engine), so what is mounted is a screenful whatever the number of options; and it has one click
 * handler and one pointer handler for all its rows, which read the row they came from.
 */
export function ValuePickerPopup({ anchor, listId, name, options, value, onValueChange, allOption, searchable, onClose }: PopupProps) {
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  /** Where the pointer was last seen over the list: a move to that same place is the engine's, not the pointer's. */
  const seen = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [initial] = useState(() => firstChosen(options, value, allOption !== undefined));
  /** The row that was moved to; undefined is the first row that can be chosen. */
  const [active, setActive] = useState(initial);
  const [placement, setPlacement] = useState<Placed>();
  const [announcement, setAnnouncement] = useState('');

  const needle = query.trim().toLowerCase();
  const visible =
    needle === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(needle) || ((reasonOf(option) ?? option.description)?.toLowerCase().includes(needle) ?? false));
  // The all row stands for no choice: it is row 0 while the search leaves it.
  const all = allOption !== undefined && (needle === '' || allOption.toLowerCase().includes(needle)) ? allOption : undefined;
  const offset = all === undefined ? 0 : 1;
  const count = visible.length + offset;
  const chosen = new Set(value);
  const lines = options.some((option) => option.description !== undefined || reasonOf(option) !== undefined) ? 2 : 1;
  const current = count === 0 ? -1 : active === undefined ? firstEnabled(visible, offset) : Math.min(active, count - 1);

  // Into the top layer first, before the hooks below read the size of the list and of a row: a popup that is not shown has no box to measure.
  useLayoutEffect(() => {
    const element = popup.current;
    if (element !== null && element.hasAttribute('popover') && !element.matches(':popover-open')) {
      element.showPopover();
    }
  }, []);

  const rowHeight = useMeasure(probe, heightOf, lines === 2 ? TWO_LINES : ONE_LINE);
  const windowed = useVirtualRows({ count, getScrollElement: () => list.current, rowHeight, overscan: OVERSCAN });
  const { totalSize, scrollToIndex } = windowed;
  // Until the list has a size (the first moment of an open popup, or an engine that lays nothing out) the first screenful stands for the window.
  const items =
    windowed.items.length > 0 || count === 0
      ? windowed.items
      : Array.from({ length: Math.min(count, FIRST_SCREEN) }, (_, index): VirtualRow => ({ index, start: index * rowHeight }));
  const first = items[0];
  const last = items.at(-1);
  const above = first === undefined ? 0 : first.start;
  const below = last === undefined ? 0 : Math.max(0, totalSize - last.start - rowHeight);
  // The field names a row that is mounted: one that was scrolled out of the window is not there to be named.
  const activeId = first !== undefined && last !== undefined && current >= first.index && current <= last.index ? `${listId}-${current}` : undefined;

  // Placed with the menus' placement, against the trigger. Again when the list changes its height: a popup above its trigger stays against it.
  useLayoutEffect(() => {
    const element = popup.current;
    const trigger = anchor.current;
    const box = list.current;
    if (element === null || trigger === null || box === null) {
      return;
    }

    const doc = element.ownerDocument;
    const win = doc.defaultView;
    const viewport = doc.documentElement;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(MIN_WIDTH, Math.round(rect.width)), Math.max(0, viewport.clientWidth - 2 * MARGIN));
    // The height the popup has when the list has all the room it needs: what is measured now, with the list's own height taken out and its natural one put in.
    const listMax = Number.parseFloat(win?.getComputedStyle(box).maxHeight ?? '');
    const natural = element.getBoundingClientRect().height - box.clientHeight + (Number.isNaN(listMax) ? totalSize : Math.min(totalSize, listMax));
    const placed = placeMenu(
      { kind: 'trigger', rect, align: 'start' },
      { width, height: natural },
      { width: viewport.clientWidth, height: viewport.clientHeight },
      win?.getComputedStyle(element).direction === 'rtl',
    );
    const next: Placed = { ...placed, width };
    setPlacement((previous) =>
      previous?.side === next.side && previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight && previous.width === next.width ? previous : next,
    );
  }, [anchor, totalSize]);

  // The focus goes in once the popup is placed: a box that is not drawn yet takes no focus.
  const placed = placement !== undefined;
  useLayoutEffect(() => {
    if (placed) {
      (searchable ? input.current : list.current)?.focus({ preventScroll: true });
    }
  }, [placed, searchable]);

  // The list opens on the first option that is chosen, when it is not in the first screen.
  useLayoutEffect(() => {
    if (initial !== undefined && initial > 0) {
      scrollToIndex(initial, { align: 'center' });
    }
  }, [initial, scrollToIndex]);

  // The popup goes when something else is used: a press or the focus outside it, a scroll that moves its trigger, or the window changing size.
  // The focus is not taken back then: it is where the user put it.
  useEffect(() => {
    const element = popup.current;
    const trigger = anchor.current;
    if (element === null || trigger === null) {
      return undefined;
    }

    const doc = element.ownerDocument;
    const win = doc.defaultView;
    if (win === null) {
      return undefined;
    }

    const away = (event: Event) => {
      const { target } = event;
      if (!(target instanceof Node && (element.contains(target) || trigger.contains(target)))) {
        onClose(false);
      }
    };

    const scroll = (event: Event) => {
      // The list's own scroll moves nothing; a scroll of the page, or of what holds the trigger, leaves the popup where it was.
      if (event.target === doc || (event.target instanceof Node && event.target.contains(trigger))) {
        onClose(false);
      }
    };

    const resize = () => {
      onClose(false);
    };

    win.addEventListener('pointerdown', away, true);
    win.addEventListener('scroll', scroll, true);
    win.addEventListener('resize', resize);
    doc.addEventListener('focusin', away);
    return () => {
      win.removeEventListener('pointerdown', away, true);
      win.removeEventListener('scroll', scroll, true);
      win.removeEventListener('resize', resize);
      doc.removeEventListener('focusin', away);
    };
  }, [anchor, onClose]);

  const toggle = (index: number) => {
    if (all !== undefined && index === 0) {
      if (value.length > 0) {
        onValueChange([]);
      }

      setAnnouncement(`${all} selected`);
      return;
    }

    const option = visible[index - offset];
    if (option === undefined || reasonOf(option) !== undefined) {
      return;
    }

    const on = chosen.has(option.value);
    onValueChange(on ? value.filter((entry) => entry !== option.value) : [...value, option.value]);
    setAnnouncement(`${option.label} ${on ? 'removed' : 'selected'}`);
  };

  const moveTo = (index: number) => {
    setActive(index);
    scrollToIndex(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key that confirms a composition is the input method's.
    if (event.nativeEvent.isComposing) {
      return;
    }

    const { key } = event;
    if (key === 'Escape') {
      // The popup's own key: the dialog or the page around it must not take it as well.
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }

    if (key === 'Tab') {
      // The focus goes back to the trigger first, so that Tab moves on from there and not into the popup. The key is not stopped.
      onClose(true);
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    // While the field holds text, Home, End and Space are its own keys: the caret and the text.
    const typing = searchable && query !== '';
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      if (count > 0) {
        moveTo(key === 'ArrowDown' ? (current + 1) % count : (current - 1 + count) % count);
      }
    } else if ((key === 'Home' || key === 'End') && !typing) {
      event.preventDefault();
      if (count > 0) {
        moveTo(key === 'Home' ? 0 : count - 1);
      }
    } else if (key === 'Enter' || (key === ' ' && !typing)) {
      // Enter is never the form's: the popup is a part of the page's form, and the key chooses.
      event.preventDefault();
      if (!event.repeat && current >= 0) {
        toggle(current);
      }
    }
  };

  const onListClick = (event: MouseEvent<HTMLDivElement>) => {
    const index = rowAt(event.target);
    if (index !== undefined && reasonOf(visible[index - offset]) === undefined) {
      setActive(index);
      toggle(index);
    }
  };

  const onListPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const index = rowAt(event.target);
    const before = seen.current;
    seen.current = { x: event.clientX, y: event.clientY };
    // A list that scrolls under a resting pointer (End, Home or an arrow reached a row outside the window) makes WebKit send a move the pointer did not make: to the place it
    // was already seen at, and the row under it must not take the active row from the keys.
    if (before !== null && before.x === event.clientX && before.y === event.clientY) {
      return;
    }

    // The row under the pointer is the active one, unless it cannot be chosen.
    if (index !== undefined && index !== current && event.pointerType !== 'touch' && reasonOf(visible[index - offset]) === undefined) {
      setActive(index);
    }
  };

  const rows = items.map(({ index }) => {
    if (all !== undefined && index === 0) {
      return <OptionRow key="all" id={`${listId}-${index}`} index={index} size={count} label={all} description={undefined} reason={undefined} selected={value.length === 0} active={index === current} />;
    }

    const option = visible[index - offset];
    if (option === undefined) {
      return null;
    }

    return (
      <OptionRow
        key={`value:${option.value}`}
        id={`${listId}-${index}`}
        index={index}
        size={count}
        label={option.label}
        description={option.description}
        reason={reasonOf(option)}
        selected={chosen.has(option.value)}
        active={index === current}
      />
    );
  });

  return (
    <div
      ref={popup}
      className={styles.popup}
      // The popover API puts the popup in the top layer, above a dialog that holds the picker. An engine without it draws a fixed box.
      popover={typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined}
      data-ov-part="popup"
      data-ov-side={placement?.side}
      data-ov-lines={lines}
      style={{
        '--_x': placement === undefined ? undefined : `${placement.left}px`,
        '--_y': placement === undefined ? undefined : `${placement.top}px`,
        '--_width': placement === undefined ? undefined : `${placement.width}px`,
        '--_max-height': placement?.maxHeight === undefined ? undefined : `${placement.maxHeight}px`,
      }}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        // A press on the list, the padding or the glyph must not take the focus out of the popup; one on the field puts the caret.
        if (!(event.target instanceof Element) || event.target.closest('input') === null) {
          event.preventDefault();
        }
      }}
    >
      {searchable ? (
        <div className={styles.search}>
          <Icon name="search" />
          <input
            ref={input}
            className={styles.input}
            type="search"
            role="combobox"
            aria-label={`Search ${name}`}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            placeholder={`Search ${name}`}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              // A new search starts at the first row, and the list is at its top.
              setQuery(event.target.value);
              setActive(undefined);
              scrollToIndex(0);
            }}
          />
        </div>
      ) : null}
      <div
        ref={list}
        id={listId}
        className={styles.list}
        role="listbox"
        aria-label={name}
        aria-multiselectable="true"
        aria-activedescendant={searchable ? undefined : activeId}
        tabIndex={searchable ? undefined : -1}
        onClick={onListClick}
        onPointerEnter={(event) => {
          seen.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={onListPointerMove}
      >
        {above > 0 ? <div className={styles.spacer} aria-hidden="true" style={{ '--_height': `${above}px` }} /> : null}
        {rows}
        {below > 0 ? <div className={styles.spacer} aria-hidden="true" style={{ '--_height': `${below}px` }} /> : null}
      </div>
      <div className={styles.empty} role="status">
        {count > 0 ? null : options.length === 0 ? 'No options available' : 'No matches'}
      </div>
      <div className={styles.live} role="status">
        {announcement}
      </div>
      <span ref={probe} className={styles.probe} aria-hidden="true" />
    </div>
  );
}
