import { useEffect, useRef, type KeyboardEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import faceStyles from '../FormControl/control.module.css';
import { useFieldControl } from '../FormControl/useFieldControl';
import styles from './TextInput.module.css';

/** The mock's three widths of a text field in a settings row (112, 280 and 320 px), or the width of its place (the default). */
export type TextInputWidth = 'short' | 'normal' | 'wide' | 'fill';

export type TextInputProps = {
  /** What the field shows. The caller owns it: the draft, which the model keeps. */
  readonly value: string;
  /** Called at once with the whole text after every change. A text field commits on Enter or blur, never per keystroke: this is only the draft. */
  readonly onValueChange: (value: string) => void;
  /** Enter, plain and not confirming a composition: commit what the field holds (design S125). */
  readonly onCommit?: ((value: string) => void) | undefined;
  /** Focus left the field, and no composition is open: commit and mark it touched. */
  readonly onBlur?: (() => void) | undefined;
  /** Escape while the field has a draft: put the applied value back. With no draft Escape goes on to the dialog or page. */
  readonly onRevert?: (() => void) | undefined;
  /** The draft differs from the applied value: Escape reverts it, and stops there. */
  readonly dirty?: boolean | undefined;
  /** The accessible name when the field has no Field around it; inside a Field the Field's label names it. */
  readonly label?: string | undefined;
  /** What the field is for, shown until there is text. Not a label. */
  readonly placeholder?: string | undefined;
  /** An identifier, an address, a key: the code face. */
  readonly mono?: boolean | undefined;
  readonly width?: TextInputWidth | undefined;
  readonly maxLength?: number | undefined;
  /**
   * Whether `text` may be typed: asked of what is about to be inserted (a key, a paste or a drop), and a refusal keeps it out before the
   * field takes it (design S125: illegal characters are refused at once). Never asked during a composition, nor for a deletion.
   */
  readonly allows?: ((text: string) => boolean) | undefined;
  /** The text is refused: `aria-invalid`, and the invalid paint. A Field around the control says it for an error of its lane. */
  readonly invalid?: boolean | undefined;
  /** A fact that cannot be changed: read-only, selectable, not dimmed (design 14 F-4). */
  readonly readOnly?: boolean | undefined;
  /** Why the field cannot change. It stays focusable and selectable with `aria-disabled`, does nothing, and has this as its description. Print the same reason in the lane (design P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
  /** Take the focus once, when the field mounts: the first field of a dialog, so that typing starts there. Use it only in a dialog, never on a page: a page that moves the focus on load takes it from where the person was. */
  readonly autoFocus?: boolean | undefined;
} & DataAttributes;

/**
 * A single line of text in a native input, the mock's `input` (design 04 sections 1 and 3, 16 S125): the draft in, every change out, Enter
 * and blur to commit, Escape to put the applied value back, and characters that are not allowed refused as they come. It is controlled and
 * changes nothing itself. Props are closed: no `className`, no `style`; `data-*` passes through to the input.
 */
export function TextInput({
  value,
  onValueChange,
  onCommit,
  onBlur,
  onRevert,
  dirty,
  label,
  placeholder,
  mono,
  width = 'fill',
  maxLength,
  allows,
  invalid,
  readOnly,
  disabledReason,
  autoFocus,
  ...rest
}: TextInputProps) {
  const control = useFieldControl({ label, invalid, readOnly, disabledReason });
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  useEffect(() => {
    const element = input.current;
    if (element === null || allows === undefined) {
      return undefined;
    }

    const refuse = (event: InputEvent) => {
      if (event.isComposing || !event.inputType.startsWith('insert')) {
        return;
      }

      const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
      if (text !== '' && !allows(text)) {
        event.preventDefault();
      }
    };

    element.addEventListener('beforeinput', refuse);
    return () => {
      element.removeEventListener('beforeinput', refuse);
    };
  }, [allows]);

  // The focus is taken in a passive effect, after the layout effects of the commit: a `Sheet` goes modal in its layout effect, and a field of a dialog that is not open yet cannot take the focus. It runs after the dialog's
  // own move to its first control, so the field wins over Close.
  useEffect(() => {
    if (autoFocus === true) {
      input.current?.focus();
    }
  }, [autoFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (control.locked || event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit?.(value);
    } else if (event.key === 'Escape' && dirty === true) {
      // The key is the field's while it has a draft: the dialog or page that would close on it does not see it.
      event.preventDefault();
      event.stopPropagation();
      onRevert?.();
    }
  };

  return (
    <>
      <input
        {...dataAttributes(rest)}
        ref={input}
        id={control.id}
        className={`${faceStyles.face} ${styles.input}`}
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        readOnly={control.locked}
        required={control.required}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        data-ov-width={width}
        data-ov-mono={mono === true ? 'true' : undefined}
        data-ov-validation={control.warning ? 'warning' : undefined}
        aria-label={control.ariaLabel}
        aria-describedby={control.describedBy}
        aria-invalid={control.invalid ? 'true' : undefined}
        aria-disabled={control.reason === undefined ? undefined : 'true'}
        onChange={(event) => {
          if (!control.locked) {
            onValueChange(event.target.value);
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!composing.current && !control.locked) {
            onBlur?.();
          }
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      />
      {control.reasonId === undefined ? null : (
        <span id={control.reasonId} hidden>
          {control.reason}
        </span>
      )}
    </>
  );
}
