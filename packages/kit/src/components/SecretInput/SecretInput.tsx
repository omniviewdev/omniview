import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import faceStyles from '../FormControl/control.module.css';
import { FieldButton } from '../FormControl/FieldButton';
import { useFieldControl } from '../FormControl/useFieldControl';
import { Icon } from '../Icon';
import styles from './SecretInput.module.css';

/** The mock's three widths of a text field in a settings row (112, 280 and 320 px), or the width of its place. */
export type SecretInputWidth = 'short' | 'normal' | 'wide' | 'fill';

export type SecretInputProps = {
  /** Whether the host holds a secret for this field: the model's `secret.presence`. It is all a view may know of one. */
  readonly presence: 'set' | 'unset';
  /**
   * The user has typed a new value (or cleared the saved one) that is not applied yet: the model's `secret.changed`. This is also how the
   * part is told to let go: when it turns false (the value was applied, reverted, or the field is gone) the part empties its field.
   */
  readonly changed: boolean;
  /** Called with the whole text after every change: the one place the typed secret goes, into the model. The part keeps no copy. */
  readonly onValueChange: (value: string) => void;
  /** Enter, plain and not confirming a composition: commit (design S125). */
  readonly onCommit?: (() => void) | undefined;
  /** Focus left the control (not for a button of it), and no composition is open. */
  readonly onBlur?: (() => void) | undefined;
  /** Escape or Cancel while something is typed: the model drops the typed secret. */
  readonly onRevert?: (() => void) | undefined;
  /** The accessible name when the field has no Field around it; inside a Field the Field's label names it, and it names every button of the part. */
  readonly label?: string | undefined;
  readonly width?: SecretInputWidth | undefined;
  readonly invalid?: boolean | undefined;
  /** A fact that cannot be changed: read-only, and nothing to replace it with (design 14 F-4). */
  readonly readOnly?: boolean | undefined;
  /** Why the field cannot change. It stays focusable with `aria-disabled`, and so does Replace, which does nothing; this is the description. Print the same reason in the lane (design P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
} & DataAttributes;

/**
 * A field for a secret (design 16 S125, FM1 "Secrets"): it shows whether one is saved ("Set" or "Not set") and never what it is; the user
 * replaces it with Replace, which opens an empty field, or types one into a field that was never set. It has no `value` prop, and the typed
 * text lives in one place: the `value` of the input in the page. The input is uncontrolled and the part keeps no copy of the text in state, in
 * markup or in an attribute; the one way out is `onValueChange`, into the model. Paste is allowed, and the browser is asked to save nothing
 * (`autocomplete="new-password"`). Show and Hide reveal only what is typed, and exist only while something can be typed: there is no reveal
 * for a secret that is only stored. When `changed` turns false the part empties the input and covers it again; when it goes, the input goes.
 * Props are closed: no `className`, no `style`; `data-*` passes through to the root.
 */
export function SecretInput({ presence, changed, onValueChange, onCommit, onBlur, onRevert, label, width = 'fill', invalid, readOnly, disabledReason, ...rest }: SecretInputProps) {
  const control = useFieldControl({ label, invalid, readOnly, disabledReason });
  const input = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  // The user opened the field with Replace, or the model holds a typed value; only booleans, never the text.
  const [replacing, setReplacing] = useState(changed);
  const [typed, setTyped] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [seen, setSeen] = useState(changed);

  if (seen !== changed) {
    // Told by the model: a typed value is held (the field opens), or it is gone (the field closes, covered and empty).
    setSeen(changed);
    setReplacing(changed);
    if (!changed) {
      setTyped(false);
      setRevealed(false);
    }
  }

  // The text is in the DOM and nowhere else, so letting go is emptying the input: here, as soon as the model says nothing is held.
  useLayoutEffect(() => {
    if (!changed && input.current !== null && input.current.value !== '') {
      input.current.value = '';
    }
  }, [changed]);

  const editing = presence === 'unset' || replacing;
  const open = editing && !control.locked;
  const state = presence === 'unset' ? (changed ? 'changed' : 'unset') : replacing ? (changed ? 'changed' : 'replacing') : 'locked';
  const name = control.name;

  const cancel = () => {
    if (input.current !== null) {
      input.current.value = '';
    }

    setTyped(false);
    setRevealed(false);
    setReplacing(false);
    if (changed || typed) {
      onRevert?.();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit?.();
    } else if (event.key === 'Escape' && (changed || typed || (replacing && presence === 'set'))) {
      // The key is the field's while something is typed or being replaced: the dialog or page that would close on it does not see it.
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const leaving = (event: FocusEvent<HTMLSpanElement>) => {
    if (!composing.current && !control.locked && !event.currentTarget.contains(event.relatedTarget)) {
      onBlur?.();
    }
  };

  return (
    <span {...dataAttributes(rest)} className={styles.root} data-ov-part="secret" data-ov-state={state} data-ov-width={width} onBlur={leaving}>
      <input
        ref={input}
        id={control.id}
        className={`${faceStyles.face} ${styles.input}`}
        type={revealed && open ? 'text' : 'password'}
        readOnly={!open}
        required={control.required && presence === 'unset'}
        placeholder={changed ? 'Changed' : presence === 'set' ? 'Set' : 'Not set'}
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-ov-mono="true"
        data-ov-validation={control.warning ? 'warning' : undefined}
        aria-label={control.ariaLabel}
        aria-describedby={control.describedBy}
        aria-invalid={control.invalid ? 'true' : undefined}
        aria-disabled={control.reason === undefined ? undefined : 'true'}
        onChange={(event) => {
          if (open) {
            setTyped(event.target.value !== '');
            onValueChange(event.target.value);
          }
        }}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      />
      {open ? (
        <FieldButton
          label={name === undefined ? 'Show' : `Show ${name}`}
          tooltip={name === undefined ? 'Show' : `Show ${name}`}
          variant="ghost"
          size="standard"
          shape="icon"
          pressed={revealed}
          disabledReason={typed ? undefined : 'Type a value first.'}
          data-ov-slot="show"
          onPress={() => {
            setRevealed(!revealed);
          }}
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} />
        </FieldButton>
      ) : presence === 'set' && !control.readOnly ? (
        <span className={styles.room} aria-hidden="true" />
      ) : null}
      {presence === 'set' && !control.readOnly ? (
        <FieldButton
          ref={action}
          label={name === undefined ? (open ? 'Cancel replacing' : 'Replace') : open ? `Cancel replacing ${name}` : `Replace ${name}`}
          variant="secondary"
          size="compact"
          disabledReason={control.reason}
          data-ov-slot="action"
          onPress={() => {
            if (open) {
              cancel();
              action.current?.focus({ preventScroll: true });
            } else {
              setReplacing(true);
              input.current?.focus({ preventScroll: true });
            }
          }}
        >
          {open ? 'Cancel' : 'Replace'}
        </FieldButton>
      ) : null}
      {control.reasonId === undefined ? null : (
        <span id={control.reasonId} hidden>
          {control.reason}
        </span>
      )}
    </span>
  );
}
