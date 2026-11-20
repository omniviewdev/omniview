import { Icon, Tabs } from '@omniviewdev/kit';
import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { platformOf } from '../core/chords';
import { KINDS, type Focus, type KeyInput, type PaletteKind, type PaletteState, type Section } from '../core/palette';
import { Band } from './Band';
import { Chips } from './Chips';
import { usePalette } from './context';
import { Foot } from './Foot';
import { rememberFocus, restoreFocus } from './focus';
import { LiveRegion } from './LiveRegion';
import styles from './Palette.module.css';
import { PaletteRow, trailingOf, type Trailing } from './Row';
import { domId, inputLabel, noteText } from './words';

// The command palette's surface (ch16 S66 to S73, ch05 "Keyboard shortcuts and command palette"): one modal dialog per window, drawn from the store's snapshot and nothing else. The model decides
// ranking, order, what the active row is and what a key does; this draws it and turns the platform's events into the model's calls. The focus stays in the input and names the active row
// (`aria-activedescendant`), and the dialog is the browser's own modal (`showModal`): the top layer, the rest of the window inert, Escape and a press outside close it and give the focus back.

/** The keys that move the active row: it is brought into view after they have. */
const MOVING: Readonly<Record<string, true>> = { ArrowDown: true, ArrowUp: true, PageDown: true, PageUp: true, Home: true, End: true };

const isPrintable = (event: KeyboardEvent): boolean => event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;

/** The row an event happened on, by the id the row carries. */
function rowIdOf(target: EventTarget): string | undefined {
  return target instanceof Element ? target.closest<HTMLElement>('[data-palette-row]')?.dataset.paletteRow : undefined;
}

/** The model's `KeyInput` for a key pressed in the input or on a chip. */
function keyInputOf(event: KeyboardEvent, target: 'input' | 'chip', index: number | undefined): KeyInput {
  const { currentTarget } = event;
  const field = currentTarget instanceof HTMLInputElement ? currentTarget : undefined;
  const collapsed = field !== undefined && field.selectionStart === field.selectionEnd;
  return {
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    isComposing: event.nativeEvent.isComposing || event.keyCode === 229,
    repeat: event.repeat,
    target,
    index,
    caret: field === undefined ? undefined : { atStart: collapsed && field.selectionStart === 0, atEnd: collapsed && field.selectionEnd === field.value.length },
  };
}

type GroupProps = { readonly section: Section; readonly state: PaletteState; readonly prefix: string };

/** A section: its heading, which assistive technology reads once as the group's name, and its rows in columns they share. */
function Group({ section, state, prefix }: GroupProps) {
  const trailing = section.rows.map((row): Trailing | undefined => trailingOf(row));
  const headed = section.title !== '';
  const headingId = domId(prefix, `heading|${section.id}`);
  return (
    <div className={styles.group} role="group" aria-labelledby={headed ? headingId : undefined} aria-label={headed ? undefined : 'Actions'} data-palette-part="group">
      {headed ? (
        <div id={headingId} className={styles.label} aria-hidden="true" data-palette-part="label">
          <span className={styles.labelText} dir="auto">
            {section.title}
          </span>
        </div>
      ) : null}
      <div
        className={styles.rows}
        data-icon={section.rows.some((row) => row.tile !== undefined) ? '' : undefined}
        data-body={section.rows.some((row) => row.context.text !== '') ? '' : undefined}
        data-meta={trailing.some((one) => one !== undefined) ? '' : undefined}
      >
        {section.rows.map((row, index) => (
          <PaletteRow key={row.id} row={row} id={domId(prefix, row.id)} active={row.id === state.active} trailing={trailing[index]} />
        ))}
      </div>
    </div>
  );
}

export function PaletteSurface() {
  const { store } = usePalette();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [platform] = useState(() => platformOf(navigator));
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** The keyboard moved the active row: it is brought into view once it has been drawn. A move by the pointer is not (the row is already under it). */
  const reveal = useRef(false);
  /** Where the caret goes once the input has the text the model gave it. */
  const caret = useRef<'start' | 'end' | null>(null);
  /** Where the pointer was last seen: a move to a row counts only when the pointer really moved (the mock: a list that scrolls under a still pointer must not steal the keyboard's row). */
  const pointer = useRef({ x: -1, y: -1 });

  // Mounting is opening: the element that has the focus is remembered, the dialog goes modal, and the input takes the keyboard. Leaving gives the focus back once the dialog is gone (a modal
  // that is still there would keep the rest of the window inert).
  useLayoutEffect(() => {
    const element = dialog.current;
    const field = input.current;
    if (element === null || field === null) {
      return undefined;
    }

    const remembered = rememberFocus();
    if (!element.open) {
      element.showModal();
    }

    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
    return () => {
      queueMicrotask(() => {
        restoreFocus(remembered);
      });
    };
  }, []);

  // After every draw: a control that held the focus and left with its markup (the `+N` link, a Retry that was answered) gives the keyboard back to the input, and a row the keyboard moved to is
  // brought into view. A focus that is on the document's own body is lost; one in the browser's own chrome is not (the document keeps its active element there).
  useLayoutEffect(() => {
    const element = dialog.current;
    const field = input.current;
    if (element === null || field === null) {
      return;
    }

    const { activeElement } = document;
    if (activeElement === null || activeElement === document.body || activeElement === element) {
      field.focus({ preventScroll: true });
    }

    if (caret.current !== null) {
      const at = caret.current === 'start' ? 0 : field.value.length;
      field.setSelectionRange(at, at);
      caret.current = null;
    }

    if (reveal.current) {
      reveal.current = false;
      document.getElementById(domId(ids, state.active))?.scrollIntoView({ block: 'nearest' });
    }
  });

  const focusOn = (focus: Focus): void => {
    if (focus.target === 'chip') {
      dialog.current?.querySelector<HTMLElement>(`[data-palette-chip-label="${String(focus.index)}"]`)?.focus({ preventScroll: true });
      return;
    }

    const field = input.current;
    if (field !== null) {
      field.focus({ preventScroll: true });
      caret.current = focus.caret;
      field.setSelectionRange(focus.caret === 'start' ? 0 : field.value.length, focus.caret === 'start' ? 0 : field.value.length);
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const keyed = keyInputOf(event, 'input', undefined);
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    // Home and End are the caret's while there is somewhere for it to go; where it has none (an empty input, or the caret already at that end) they go on to the first and the last row.
    if (plain && keyed.isComposing !== true && (event.key === 'Home' || event.key === 'End')) {
      const there = event.key === 'Home' ? keyed.caret?.atStart : keyed.caret?.atEnd;
      const { rows } = store.getSnapshot();
      if (there === true && rows.length > 0) {
        event.preventDefault();
        reveal.current = true;
        store.move(event.key === 'Home' ? -rows.length : rows.length, { wrap: false });
      }

      return;
    }

    const outcome = store.key(keyed);
    if (outcome.handled) {
      event.preventDefault();
      reveal.current = Object.hasOwn(MOVING, event.key);
    }

    if (outcome.focus !== undefined) {
      focusOn(outcome.focus);
    }
  };

  const onChipKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const outcome = store.key(keyInputOf(event, 'chip', index));
    if (outcome.handled) {
      event.preventDefault();
    } else if (isPrintable(event)) {
      // A character typed on a chip is typed into the input: the focus moves there before the character is made.
      input.current?.focus({ preventScroll: true });
    }

    if (outcome.focus !== undefined) {
      focusOn(outcome.focus);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') {
      return;
    }

    const moved = event.clientX !== pointer.current.x || event.clientY !== pointer.current.y;
    pointer.current = { x: event.clientX, y: event.clientY };
    const id = moved ? rowIdOf(event.target) : undefined;
    if (id !== undefined) {
      store.focus(id);
    }
  };

  const onListClick = (event: MouseEvent<HTMLDivElement>): void => {
    const id = rowIdOf(event.target);
    if (id === undefined) {
      return;
    }

    if (event.target instanceof Element && event.target.closest('[data-palette-drill]') !== null) {
      store.enter(id);
      return;
    }

    store.activate(id, event.nativeEvent);
  };

  const onListAuxClick = (event: MouseEvent<HTMLDivElement>): void => {
    const id = rowIdOf(event.target);
    if (id !== undefined && event.button === 1) {
      event.preventDefault();
      store.activate(id, 'background');
    }
  };

  const listId = domId(ids, 'list');
  const panelId = domId(ids, 'kinds-panel');
  const kindBase = domId(ids, 'kinds');
  const sources = state.view === 'sources';
  const active = state.rows[state.activeIndex];
  const note = noteText(state.note);
  return (
    <dialog
      ref={dialog}
      className={styles.scrim}
      aria-labelledby={domId(ids, 'title')}
      data-palette-part="scrim"
      onPointerDown={(event) => {
        // A press on the scrim, outside the frame, closes (the mock's dismissOnBackdrop); a press inside never does.
        if (event.target === event.currentTarget) {
          store.close();
        }
      }}
      onCancel={(event) => {
        // The browser's own close request (Escape with the focus on a control that is not the input, a platform's back gesture) is what the model takes Escape for: the Sources list goes back to the results with
        // the search kept, the results close, and what the model keeps is kept. The browser does not close the dialog behind it.
        event.preventDefault();
        const outcome = store.key({ key: 'Escape' });
        if (outcome.focus !== undefined) {
          focusOn(outcome.focus);
        } else if (!outcome.handled) {
          store.close();
        }
      }}
    >
      <div className={styles.frame} data-palette-part="frame">
        <h2 className={styles.hidden} id={domId(ids, 'title')}>
          Search
        </h2>
        <span className={styles.glyph} aria-hidden="true" data-palette-part="glyph">
          <Icon name="search" />
        </span>
        {state.chips.length === 0 ? null : (
          <Chips
            chips={state.chips}
            selected={state.chip}
            onSelect={(index) => {
              store.selectChip(index);
              dialog.current?.querySelector<HTMLElement>(`[data-palette-chip-label="${String(index)}"]`)?.focus({ preventScroll: true });
            }}
            onRemove={(index) => {
              store.removeChip(index);
              focusOn({ target: 'input', caret: 'end' });
            }}
            onKeyDown={onChipKeyDown}
          />
        )}
        <input
          ref={input}
          id={domId(ids, 'input')}
          className={styles.input}
          type="text"
          role="combobox"
          aria-label={inputLabel(state.chips)}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active === undefined ? undefined : domId(ids, active.id)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={256}
          placeholder={KINDS.find((kind) => kind.id === state.kind)?.placeholder}
          value={state.query}
          data-palette-part="input"
          onChange={(event) => {
            store.setQuery(event.target.value);
          }}
          onCompositionStart={() => {
            store.compositionStart();
          }}
          onCompositionEnd={(event) => {
            store.compositionEnd(event.currentTarget.value);
          }}
          onKeyDown={onInputKeyDown}
        />
        <div className={styles.kinds} data-palette-part="kinds">
          <Tabs
            id={kindBase}
            label="Result kinds"
            tabs={KINDS.map((kind) => ({ id: kind.id, label: kind.label }))}
            selected={state.kind}
            onSelect={(id) => {
              const kind = KINDS.find((candidate) => candidate.id === id);
              if (kind !== undefined) {
                store.setKind(kind.id satisfies PaletteKind);
              }
            }}
          />
        </div>
        <div className={styles.results} id={panelId} role="tabpanel" aria-labelledby={`${kindBase}-tab-${state.kind}`} data-palette-part="results">
          {note === '' ? null : (
            <p className={styles.note} data-palette-part="note">
              {note}
            </p>
          )}
          <div
            className={styles.list}
            id={listId}
            role="listbox"
            aria-label={sources ? 'Sources' : 'Results'}
            aria-busy={state.searching}
            onClick={onListClick}
            onAuxClick={onListAuxClick}
            onMouseDown={(event) => {
              // A press on a row must not take the focus from the input.
              event.preventDefault();
            }}
            onPointerMove={onPointerMove}
          >
            {state.sections.map((section) => (
              <Group key={section.id} section={section} state={state} prefix={ids} />
            ))}
          </div>
        </div>
        <Band
          state={state}
          onRetry={(source) => {
            store.retry(source);
          }}
          onSources={() => {
            store.showSources();
          }}
          onResults={() => {
            store.showResults();
          }}
        />
        <Foot state={state} platform={platform} />
        <LiveRegion />
      </div>
    </dialog>
  );
}
