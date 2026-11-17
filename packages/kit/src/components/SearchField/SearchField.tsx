import { useId, useRef, type KeyboardEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon } from '../Icon';
import styles from './SearchField.module.css';

export type SearchFieldProps = {
  /** What it searches, as its accessible name ("Search items"). Required: a glyph names nothing (design 14 P4). */
  readonly label: string;
  /** The hint shown while the field is empty. It is the label unless the field has something more useful to say. */
  readonly placeholder?: string | undefined;
  /** The draft: what the field shows. The caller owns it, and so owns the delay (500 ms in the list page) before the draft does any work. */
  readonly value: string;
  /** Called at once with the whole text after every change, the clear button and Escape included. */
  readonly onValueChange: (value: string) => void;
  /** Called on Enter, for a caller that waits before it searches: the work it was waiting for starts now. */
  readonly onSubmit?: (() => void) | undefined;
  /**
   * The count lane (design PN-07): a lane of fixed width inside the field, at its trailing end, for the result of a search in the content
   * ("3 of 12"). Its text may change or go and nothing moves, because the lane stays while its text is empty. A list's count is not
   * here: the toolbar carries no count text (13 N3), the footer does. Absent: no lane.
   */
  readonly count?: string | undefined;
  /** The text cannot be searched for (a malformed pattern): the field and its count take the error colour. */
  readonly invalid?: boolean | undefined;
} & DataAttributes;

/**
 * The field of a toolbar that searches (design 12 TB1, 13 N3, 14 P4): a native search input with the search glyph inside its start,
 * a clear button inside its end while it holds text, and, when it is given a count, the count lane. Escape clears the text and Enter
 * submits it. It is one tab stop: the clear button is for the pointer, Escape is the keyboard's way. Props are closed: no `className`,
 * no `style`, no `title`; `data-*` passes through to the input.
 */
export function SearchField({ label, placeholder, value, onValueChange, onSubmit, count, invalid, ...rest }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const laneId = useId();
  const counted = count !== undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // A key that confirms a composition, and a chord, are not the field's.
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Escape' && value !== '' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      // The text is the caller's, so the clear is a change like any other; and the key stops here, because the page takes an Escape with nothing to clear.
      event.preventDefault();
      event.stopPropagation();
      onValueChange('');
    } else if (event.key === 'Enter' && onSubmit !== undefined) {
      onSubmit();
    }
  };

  return (
    <div className={styles.root} data-ov-counted={counted ? 'true' : undefined}>
      <Icon name="search" />
      <input
        {...dataAttributes(rest)}
        ref={input}
        className={styles.input}
        type="search"
        aria-label={label}
        aria-invalid={invalid === true ? 'true' : undefined}
        aria-describedby={counted ? laneId : undefined}
        placeholder={placeholder ?? label}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {counted ? (
        <span className={styles.lane} id={laneId} data-ov-lane="" aria-live="polite">
          {count}
        </span>
      ) : null}
      {value === '' ? null : (
        <button
          type="button"
          className={styles.clear}
          tabIndex={-1}
          aria-label="Clear search"
          onMouseDown={(event) => {
            // The press must not take the focus from the field: the next key is still typed into it.
            event.preventDefault();
          }}
          onClick={() => {
            onValueChange('');
            input.current?.focus();
          }}
        >
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}
