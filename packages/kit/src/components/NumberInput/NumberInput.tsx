import { useRef, type FocusEvent, type KeyboardEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { FieldButton } from '../FormControl/FieldButton';
import { useFieldControl } from '../FormControl/useFieldControl';
import { Icon } from '../Icon';
import styles from './NumberInput.module.css';

export type NumberInputProps = {
  /** The text in the field, as it was typed: a number, or what is not one yet. The part never clamps, rounds or reads it for the caller. */
  readonly value: string;
  /** Called at once with the whole text after every change, and with the next number as text when a step moves it. */
  readonly onValueChange: (value: string) => void;
  /** Enter, or a step by the arrows, Page Up, Page Down or a stepper: apply the text (design S125). Called with the text it applies. */
  readonly onCommit?: ((value: string) => void) | undefined;
  /** Focus left the control (not for another part of it), and no composition is open. */
  readonly onBlur?: (() => void) | undefined;
  /** Escape while the field has a draft: put the applied value back. With no draft Escape goes on to the dialog or page. */
  readonly onRevert?: (() => void) | undefined;
  /** The draft differs from the applied value: Escape reverts it, and stops there. */
  readonly dirty?: boolean | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  /** The step of the arrows and the steppers, and the grid a valid number sits on (it starts at `min`, else 0). One by default. */
  readonly step?: number | undefined;
  /** A muted word after the number: "px", "digits", "×". */
  readonly unit?: string | undefined;
  /** The accessible name when the field has no Field around it; inside a Field the Field's label names it. */
  readonly label?: string | undefined;
  readonly invalid?: boolean | undefined;
  /** A fact that cannot be changed: read-only, not dimmed (design 14 F-4); the steppers do nothing. */
  readonly readOnly?: boolean | undefined;
  /** Why the field cannot change. It stays focusable and selectable with `aria-disabled`, and so do its steppers; this is its description. Print the same reason in the lane (design P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
} & DataAttributes;

const numberOf = (text: string): number | null => (text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text));

/** A number without the error of adding decimals (1.1 + 0.1), as text. */
const rounded = (value: number): number => Number(value.toFixed(10));

/**
 * A number in the mock's stepper (`H.stepper` with `commit: 'reject'` and `oneStop`, design 14 P6, 16 S125, A18): a field with a decrease and an
 * increase step, in one face. The field is the one tab stop; the arrows step it, Page Up and Page Down step it by a tenth of its range, and
 * Decrease and Increase are shortcuts for the pointer that take no focus and are no tab stops. The text stays as it was typed until the
 * caller applies it: an empty, unreadable, out of range or off-grid number is never corrected here, the model says what is wrong.
 * Props are closed: no `className`, no `style`; `data-*` passes through to the group.
 */
export function NumberInput({
  value,
  onValueChange,
  onCommit,
  onBlur,
  onRevert,
  dirty,
  min,
  max,
  step,
  unit,
  label,
  invalid,
  readOnly,
  disabledReason,
  ...rest
}: NumberInputProps) {
  const control = useFieldControl({ label, invalid, readOnly, disabledReason });
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const by = Math.abs(step ?? 1) || 1;
  const number = numberOf(value);
  const grid = number === null ? 0 : (number - (min ?? 0)) / by;
  // Not a number the field can hold: outside the bounds, or between two steps of the grid (it starts at the minimum, else 0).
  const offGrid = number !== null && ((min !== undefined && number < min) || (max !== undefined && number > max) || Math.abs(grid - Math.round(grid)) > 1e-7);
  const shown = number !== null && !offGrid ? number : undefined;
  const pageSteps = min !== undefined && max !== undefined ? Math.max(1, Math.round((max - min) / by / 10)) : 10;

  const apply = (text: string) => {
    onValueChange(text);
    onCommit?.(text);
  };

  const reasonOf = (direction: 1 | -1): string | undefined => {
    if (control.reason !== undefined) {
      return control.reason;
    }

    if (control.readOnly) {
      return 'Read-only';
    }

    if (number !== null && direction < 0 && min !== undefined && number <= min) {
      return `Minimum is ${min}`;
    }

    return number !== null && direction > 0 && max !== undefined && number >= max ? `Maximum is ${max}` : undefined;
  };

  /** The next number of a stepper: from the number, or from the minimum when the text is not one, kept inside the bounds. */
  const stepped = (direction: 1 | -1): string => {
    const next = rounded((number ?? min ?? 0) + direction * by);
    return String(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }

    const { key } = event;
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown') {
      event.preventDefault();
      if (control.locked || number === null || offGrid) {
        return;
      }

      const next = rounded(number + (key === 'ArrowUp' || key === 'PageUp' ? 1 : -1) * by * (key.startsWith('Page') ? pageSteps : 1));
      // A step past a bound does nothing: the number is never corrected for the user.
      if ((min === undefined || next >= min) && (max === undefined || next <= max)) {
        apply(String(next));
      }
    } else if (control.locked) {
      // Nothing else of the keyboard changes a field that cannot change.
    } else if (key === 'Enter') {
      event.preventDefault();
      onCommit?.(value);
    } else if (key === 'Escape' && dirty === true) {
      event.preventDefault();
      event.stopPropagation();
      onRevert?.();
    }
  };

  const leaving = (event: FocusEvent<HTMLSpanElement>) => {
    if (!composing.current && !control.locked && !event.currentTarget.contains(event.relatedTarget)) {
      onBlur?.();
    }
  };

  return (
    <span
      {...dataAttributes(rest)}
      className={styles.group}
      data-ov-part="stepper"
      role="group"
      aria-label={control.ariaLabel}
      aria-labelledby={control.labelId}
      onBlur={leaving}
    >
      <FieldButton
        label={control.name === undefined ? 'Decrease' : `Decrease ${control.name}`}
        tooltip={control.name === undefined ? 'Decrease' : `Decrease ${control.name}`}
        variant="ghost"
        size="row"
        shape="icon"
        tabStop={false}
        disabledReason={reasonOf(-1)}
        data-ov-slot="decrease"
        onPressStart={() => {
          input.current?.focus();
        }}
        onPress={() => {
          apply(stepped(-1));
        }}
      >
        <Icon name="minus" />
      </FieldButton>
      <input
        ref={input}
        id={control.id}
        className={styles.field}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        value={value}
        readOnly={control.locked}
        required={control.required}
        autoComplete="off"
        spellCheck={false}
        data-ov-mono="true"
        aria-label={control.ariaLabel}
        aria-describedby={control.describedBy}
        aria-invalid={control.invalid ? 'true' : undefined}
        aria-disabled={control.reason === undefined ? undefined : 'true'}
        aria-valuenow={shown}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={shown !== undefined && unit !== undefined && unit !== '' ? `${shown} ${unit}` : undefined}
        onChange={(event) => {
          if (!control.locked) {
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
      {unit === undefined || unit === '' ? null : (
        <span className={styles.unit} data-ov-part="unit" aria-hidden="true">
          {unit}
        </span>
      )}
      <FieldButton
        label={control.name === undefined ? 'Increase' : `Increase ${control.name}`}
        tooltip={control.name === undefined ? 'Increase' : `Increase ${control.name}`}
        variant="ghost"
        size="row"
        shape="icon"
        tabStop={false}
        disabledReason={reasonOf(1)}
        data-ov-slot="increase"
        onPressStart={() => {
          input.current?.focus();
        }}
        onPress={() => {
          apply(stepped(1));
        }}
      >
        <Icon name="plus" />
      </FieldButton>
      {control.reasonId === undefined ? null : (
        <span id={control.reasonId} hidden>
          {control.reason}
        </span>
      )}
    </span>
  );
}
