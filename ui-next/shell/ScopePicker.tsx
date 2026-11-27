import { Icon, Status, tip } from '@omniviewdev/kit';
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LIMITS, partsOf, type Range } from './core/palette';
import { filterOptions } from './core/picker/filter';
import { placePicker, type Placement } from './core/picker/place';
import { restoreFocus } from './palette/focus';
import { domId } from './palette/words';
import type { ShellPickerOption, ShellScopePicker } from './registration';
import styles from './ScopePicker.module.css';

// The popup a scope face opens (HM1): a list of the things that face can say, with a field above it to narrow the list by typing. It is mounted by the face only while it is open, so a closed picker draws nothing and listens to
// nothing. It is the browser's own popover (`popover="auto"`, the top layer): no ancestor clips it, nothing needs a z-index, and a press outside it, or the browser's own close request, closes it. It is placed once, from the face's
// rectangle (core/picker/place.ts), and never follows the face: resizing the window or scrolling the scope group closes it.
//
// The focus stays in the field and names the active option (`aria-activedescendant`), as the palette's does, so an option is not a Tab stop: Tab leaves the picker and the browser goes on from the face. What the picker does with a
// choice is the host's: it says which id was chosen and stays open until the host answers (the option goes busy, then is the current one, which closes the picker, or it gains a reason).

/** The most that the field takes: the palette's own limit, so a pasted page of text never lands in the live region. */
const MAX_QUERY = 256;

/** The first option of a list that was just opened or narrowed: the browser's own `showPopover` throws where the popover is open already (a development build mounts an effect twice), and there is nothing to do then. */
function showPopover(element: HTMLElement): void {
  try {
    element.showPopover();
  } catch {
    // It is open already.
  }
}

/** What the live region says of how many options there are, and how many a query kept. */
function countText(title: string, shown: number, total: number, query: string): string {
  const typed = query.trim();
  if (typed === '') {
    return `${title}: ${String(total)}`;
  }

  return shown === 0 ? noMatches(typed) : `${title}: ${String(shown)} of ${String(total)}`;
}

/** What the list says, and the live region with it, when a query keeps nothing. */
const noMatches = (query: string): string => `No matches for "${query}"`;

/**
 * What a change of the options says aloud: an option that has turned busy says its state and its name ("Connecting… north"), one that has gained a reason says its name and the reason ("north: certificate has expired"). Text
 * that did not change is not here, so it is not said again. When several things changed at once, the last one is what is said.
 */
function changeText(before: readonly ShellPickerOption[], after: readonly ShellPickerOption[]): string | undefined {
  const was = new Map(before.map((option) => [option.id, option]));
  let said: string | undefined;
  for (const option of after) {
    const earlier = was.get(option.id);
    const reason = option.reason ?? '';
    if (earlier === undefined) {
      continue;
    }

    if (option.busy === true && earlier.busy !== true) {
      said = `${option.state.word} ${option.label}`;
    } else if (reason !== '' && reason !== earlier.reason) {
      said = `${option.label}: ${reason}`;
    }
  }

  return said;
}

/** A label as the filter cut it: the matched runs in weight 600 and the rest plain. The runs never move, so the place of a run in the text is its key. */
function Label({ text, ranges }: { readonly text: string; readonly ranges: readonly Range[] }) {
  return (
    <>
      {partsOf(text, ranges).map((part, index, parts) => (
        <Fragment key={parts.slice(0, index).reduce((at, before) => at + before.text.length, 0)}>{part.match ? <b>{part.text}</b> : part.text}</Fragment>
      ))}
    </>
  );
}

type ScopePickerProps = {
  readonly picker: ShellScopePicker;
  /** The face's button: the popup is placed from its rectangle, and gives it the focus back. */
  readonly anchor: HTMLElement;
  /** The id of the popup, which the face's `aria-controls` names while it is open. */
  readonly id: string;
  /** The popup is done: the face stops drawing it. */
  readonly onClose: () => void;
};

/**
 * The popup of a face that has a picker: an input row (a search glyph and a field named by the picker's title), the title as a muted heading, and the listbox. The keys, which are the field's: ArrowDown and ArrowUp move the active
 * option and stop at the ends (PageDown and PageUp move by 8; Home and End go to the first and the last while the field is empty, and are the caret's while it is not); typing narrows the list and makes the first match active (the
 * current option when the field is empty again); Enter chooses the active option, which closes the picker when it is the current one and does nothing when it is busy; Escape closes and gives the focus back to the face; Tab and
 * Shift+Tab close it and leave the focus on the face, so the browser goes on from there. A press on an option is Enter on it. Kit part it should become: a listbox popup.
 */
export function ScopePicker({ picker, anchor, id, onClose }: ScopePickerProps) {
  const ids = useId();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  /** The keyboard moved the active option, or the list was narrowed, or it has just opened: the active option is brought into view once it has been drawn. A move by the pointer is not (the option is under it). */
  const reveal = useRef(true);
  /** Where the pointer was last seen: a move onto an option counts only when the pointer really moved (a list that scrolls under a still pointer must not steal the keyboard's option). */
  const pointer = useRef({ x: -1, y: -1 });
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);
  const [query, setQuery] = useState('');
  /** The active option's id. The list opens on the current option; an id that is not in the list (the query kept others, the host took it away) is the first option. */
  const [activeId, setActiveId] = useState<string | undefined>(picker.current);
  const [said, setSaid] = useState(() => countText(picker.title, picker.options.length, picker.options.length, ''));
  const [seen, setSeen] = useState(picker.options);

  // The options the host hands over change while the popup is open: it marks one busy, then gives it a reason. What changed is said once, when it changed.
  if (seen !== picker.options) {
    setSeen(picker.options);
    const told = changeText(seen, picker.options);
    if (told !== undefined) {
      setSaid(told);
    }
  }

  const results = filterOptions(picker.options, query);
  const found = results.findIndex((result) => result.option.id === activeId);
  const activeIndex = found >= 0 ? found : results.length > 0 ? 0 : -1;
  const activeOption = results[activeIndex]?.option;
  const listId = `${ids}-list`;
  const optionId = (optionKey: string): string => domId(`${ids}-option`, optionKey);
  const empty = picker.options.length === 0;
  const note = empty ? picker.empty : results.length === 0 ? noMatches(query.trim()) : '';

  // Mounting is opening: the popover goes to the top layer, is placed once from the rectangle of the face and its own, and the field takes the keyboard. The popup is `position: fixed` whether or not the engine has the Popover API, so
  // where it has none (an engine that does not know the attribute) it is simply the open box it is drawn as, which clips only under an ancestor with a transform, a filter or containment.
  useLayoutEffect(() => {
    const popup = root.current;
    const input = field.current;
    if (popup === null || input === null) {
      return;
    }

    if (typeof popup.showPopover === 'function') {
      showPopover(popup);
    }

    const { documentElement } = popup.ownerDocument;
    const size = popup.getBoundingClientRect();
    setPlacement(placePicker(anchor.getBoundingClientRect(), { width: size.width, height: size.height }, { width: documentElement.clientWidth, height: documentElement.clientHeight }));
    input.focus({ preventScroll: true });
  }, [anchor]);

  // Leaving gives the focus back to the face, where the keyboard was, but only a focus that was lost: a press on another control that took the focus, or the Tab that left, keeps what it chose (the palette's rule). A choice that the host
  // answered by moving the page draws the lane again with the page of the new value, and the button the person was on is gone with it: the face is found again by its label, which is what the person was on.
  useLayoutEffect(() => {
    const label = anchor.dataset.scopeFace;
    return () => {
      queueMicrotask(() => {
        const drawnAgain = anchor.isConnected || label === undefined ? undefined : [...anchor.ownerDocument.querySelectorAll<HTMLElement>('[data-shell-part="scopeFace"][aria-haspopup="listbox"]')].find((face) => face.dataset.scopeFace === label);
        restoreFocus({ element: drawnAgain ?? anchor });
      });
    };
  }, [anchor]);

  // The popup is placed once. Close it if the window resizes or its anchor moves in the header's horizontal scroller.
  useEffect(() => {
    const view = anchor.ownerDocument.defaultView;
    const lane = anchor.parentElement;
    lane?.addEventListener('scroll', onClose);
    view?.addEventListener('resize', onClose);
    return () => {
      view?.removeEventListener('resize', onClose);
      lane?.removeEventListener('scroll', onClose);
    };
  }, [anchor, onClose]);

  // After a draw the keyboard moved the active option in, or the popup opened on: the option is brought into view.
  useLayoutEffect(() => {
    if (reveal.current) {
      reveal.current = false;
      root.current?.querySelector<HTMLElement>('[role="option"][data-active]')?.scrollIntoView?.({ block: 'nearest' });
    }
  });

  /** Closes the popup; the focus goes back to the face when it was asked to (a person's Escape, Tab, or a choice that was the current option), and otherwise stays where the person put it. */
  const leave = (restore: boolean): void => {
    if (restore) {
      anchor.focus({ preventScroll: true });
    }

    onClose();
  };

  /** What Enter does with an option, and so what a press on one does: the current option, or none, only closes the picker; a busy option is not chosen again; any other is the host's to answer. */
  const choose = (option: ShellPickerOption | undefined): void => {
    if (option === undefined || option.id === picker.current) {
      leave(true);
    } else if (option.busy !== true) {
      picker.onChoose(option.id);
    }
  };

  /** The active option moves to the one at `index`, and stops at the ends. */
  const moveTo = (index: number): void => {
    const next = results[Math.max(0, Math.min(results.length - 1, index))];
    if (next !== undefined) {
      reveal.current = true;
      setActiveId(next.option.id);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // A key the input method is composing with is the method's, and a chord with Control, Alt or Command is the platform's.
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const { key } = event;
    if (key === 'Tab') {
      // Not prevented: the focus is on the face when the browser takes the key, so it goes on from there (to the next stop, or to the previous with Shift).
      leave(true);
      return;
    }

    if (event.shiftKey) {
      return;
    }

    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveTo(activeIndex - 1);
        break;
      case 'PageDown':
        event.preventDefault();
        moveTo(activeIndex + LIMITS.page);
        break;
      case 'PageUp':
        event.preventDefault();
        moveTo(activeIndex - LIMITS.page);
        break;
      case 'Home':
      case 'End':
        // The caret's while there is text to move it in: only an empty field gives them to the list.
        if (query === '') {
          event.preventDefault();
          moveTo(key === 'Home' ? 0 : results.length - 1);
        }

        break;
      case 'Enter':
        event.preventDefault();
        choose(activeOption);
        break;
      case 'Escape':
        // The picker's alone: nothing else of the window takes this press for its own.
        event.preventDefault();
        event.stopPropagation();
        leave(true);
        break;
      default:
        break;
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>, optionKey: string): void => {
    if (event.pointerType === 'touch') {
      return;
    }

    const moved = event.clientX !== pointer.current.x || event.clientY !== pointer.current.y;
    pointer.current = { x: event.clientX, y: event.clientY };
    if (moved) {
      setActiveId(optionKey);
    }
  };

  return (
    <div
      ref={root}
      id={id}
      className={styles.popup}
      popover="auto"
      data-side={placement?.side}
      data-shell-part="picker"
      style={{
        '--_left': placement === undefined ? undefined : `${String(placement.left)}px`,
        '--_edge': placement === undefined ? undefined : `${String(placement.edge)}px`,
        '--_max': placement === undefined ? undefined : `${String(placement.maxHeight)}px`,
      }}
      onToggle={(event) => {
        // The browser closed it (a press outside, its own close request): the face stops drawing it. The focus goes back to the face only if it was lost; a press that landed on another control took the focus there.
        if (event.newState === 'closed') {
          onClose();
        }
      }}
      onBlur={(event) => {
        // The focus went to another control (F6, a script): the popup closes and the focus stays where it went. The face is not another control, and a focus that went nowhere (the window lost it) leaves the popup open.
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next) && !anchor.contains(next)) {
          onClose();
        }
      }}
      onMouseDown={(event) => {
        // A press anywhere in the popup but the field must not take the focus from the field, where the keys go. The field is pressed to put the caret in it.
        if (event.target !== field.current) {
          event.preventDefault();
        }
      }}
    >
      <div className={styles.search} data-shell-part="pickerSearch">
        <span className={styles.lead}>
          <Icon name="search" />
        </span>
        <input
          ref={field}
          className={styles.input}
          type="text"
          role="combobox"
          aria-label={picker.title}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeOption === undefined ? undefined : optionId(activeOption.id)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={MAX_QUERY}
          placeholder={picker.placeholder}
          value={query}
          data-shell-part="pickerInput"
          onChange={(event) => {
            const typed = event.target.value;
            reveal.current = true;
            setQuery(typed);
            // Narrowed, the first match is active; with nothing typed any more the list is whole again and the current option is the one it opened on.
            setActiveId(typed.trim() === '' ? picker.current : undefined);
            setSaid(countText(picker.title, filterOptions(picker.options, typed).length, picker.options.length, typed));
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className={styles.heading} aria-hidden="true" data-shell-part="pickerHeading">
        {picker.title}
      </div>
      <div className={styles.body} data-shell-part="pickerBody">
        {note === '' ? null : (
          <p className={styles.note} data-shell-part="pickerNote">
            {note}
          </p>
        )}
        <div id={listId} className={styles.list} role="listbox" aria-label={picker.title} data-shell-part="pickerList">
          {results.map(({ option, ranges }, index) => {
            const isCurrent = option.id === picker.current;
            const reason = option.reason ?? '';
            const detail = option.detail ?? '';
            return (
              <div
                key={option.id}
                id={optionId(option.id)}
                className={styles.option}
                role="option"
                aria-selected={isCurrent}
                aria-disabled={option.busy === true ? true : undefined}
                data-active={index === activeIndex ? '' : undefined}
                data-shell-part="pickerOption"
                onClick={() => {
                  choose(option);
                }}
                onPointerMove={(event) => {
                  onPointerMove(event, option.id);
                }}
              >
                <span className={styles.mark} aria-hidden="true">
                  {isCurrent ? '•' : ''}
                </span>
                <span className={styles.icon}>
                  <Icon name={picker.icon} />
                </span>
                {/* The parts are spaced as words: the name a reader of the markup finds is a sentence, "north Connected". A space between grid items is not drawn. */}
                <span className={styles.label} data-ov-clip="">
                  <Label text={option.label} ranges={ranges} />
                </span>{' '}
                <span className={styles.state} data-shell-part="pickerState">
                  <Status role={option.state.role}>{option.state.word}</Status>
                </span>
                {reason === '' ? null : (
                  <>
                    {' '}
                    <span className={styles.reason} data-shell-part="pickerReason" {...tip(reason)}>
                      {reason}
                    </span>
                  </>
                )}
                {reason !== '' || detail === '' ? null : (
                  <>
                    {' '}
                    <span className={styles.detail} data-shell-part="pickerDetail" {...tip(detail)}>
                      {detail}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.hidden} role="status" aria-live="polite" aria-atomic="true" data-shell-part="pickerLive">
        {said}
      </div>
    </div>
  );
}
