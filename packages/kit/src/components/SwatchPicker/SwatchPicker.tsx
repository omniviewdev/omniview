import { useId, useState, type KeyboardEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import type { DataColor } from '../../theme/dataColor';
import { useFieldControl } from '../FormControl/useFieldControl';
import { Icon } from '../Icon';
import { tip } from '../TooltipHost';
import styles from './SwatchPicker.module.css';

export type SwatchOption = {
  readonly color: DataColor;
  /** The colour's name, for assistive technology and the tooltip: "Blue", never its hex value. */
  readonly label: string;
  /** Why the colour cannot be chosen. It stays in the group, reachable by the arrows, `aria-disabled`, with this as its tooltip and its description; choosing it does nothing. */
  readonly disabledReason?: string | undefined;
};

export type SwatchPickerProps = {
  /** The accessible name of the group when no `Field` names it. Inside a `Field` the Field's label names it. */
  readonly label?: string | undefined;
  readonly options: readonly SwatchOption[];
  /** The chosen colour. `null` is the default colour: nothing is checked. The caller owns it. */
  readonly value: DataColor | null;
  /** Called with the colour the user chooses, by the pointer or by Enter or Space. Choosing the colour that is already chosen does not call it. */
  readonly onValueChange: (color: DataColor) => void;
} & DataAttributes;

/**
 * A choice of one colour out of a few, as a row of swatches: a radiogroup of native buttons with the radio role. The chosen swatch has a ring
 * and a check mark, so the choice is never the colour alone. It is one Tab stop (the chosen swatch, else the first that can be chosen); the
 * arrows, Home and End move the focus along the row and wrap, and Enter or Space (or a click) chooses: moving never chooses. A swatch that is
 * unavailable for a reason stays reachable. Inside a `Field` it is named, described and locked by the Field. Props are closed: no `className`,
 * no `style`; `data-*` passes through.
 */
export function SwatchPicker({ label, options, value, onValueChange, ...rest }: SwatchPickerProps) {
  const control = useFieldControl({ label, invalid: undefined, readOnly: undefined, disabledReason: undefined });
  const base = useId();
  // The swatch the focus last was on is the Tab stop while the focus stays in the group; once it leaves, the chosen swatch is the stop again.
  const [focused, setFocused] = useState<DataColor | null>(null);

  // The reason a swatch is unavailable, from its option or from the Field; the swatch stays in the group and reachable.
  const reasons = options.map((option) => (option.disabledReason === undefined || option.disabledReason.trim() === '' ? control.reason : option.disabledReason));
  // The Tab stop: the swatch the focus last was on, else the chosen one, else the first that can be chosen, else the first.
  const focusedAt = options.findIndex((option) => option.color === focused);
  const chosenAt = options.findIndex((option) => option.color === value);
  const stop = focusedAt >= 0 ? focusedAt : chosenAt >= 0 ? chosenAt : Math.max(0, reasons.findIndex((reason) => reason === undefined));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key that something else took, a composition, and a chord are not the group's.
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') {
      return;
    }

    const swatches = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const at = swatches.indexOf(event.target as HTMLElement);
    if (at < 0) {
      return;
    }

    event.preventDefault();
    const last = swatches.length - 1;
    const to = key === 'Home' ? 0 : key === 'End' ? last : key === 'ArrowLeft' || key === 'ArrowUp' ? (at + last) % swatches.length : (at + 1) % swatches.length;
    swatches[to]?.focus();
  };

  return (
    <div
      {...dataAttributes(rest)}
      className={styles.root}
      role="radiogroup"
      aria-label={control.ariaLabel}
      aria-labelledby={control.labelId}
      aria-describedby={control.describedBy}
      aria-invalid={control.invalid ? 'true' : undefined}
      aria-required={control.required ? 'true' : undefined}
      aria-readonly={control.readOnly ? 'true' : undefined}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(null);
        }
      }}
    >
      {options.map((option, index) => {
        const reason = reasons[index];
        const checked = option.color === value;
        const reasonId = `${base}-${index}`;
        return (
          <button
            key={option.color}
            {...dataAttributes(tip(reason ?? option.label))}
            type="button"
            role="radio"
            className={styles.option}
            data-ov-color={option.color}
            aria-checked={checked}
            aria-label={option.label}
            aria-disabled={reason === undefined ? undefined : 'true'}
            aria-describedby={reason === undefined ? undefined : reasonId}
            tabIndex={index === stop ? 0 : -1}
            onFocus={() => {
              setFocused(option.color);
            }}
            onClick={() => {
              if (reason === undefined && !control.readOnly && !checked) {
                onValueChange(option.color);
              }
            }}
          >
            <span className={styles.dot} data-ov-part="dot">
              {checked ? <Icon name="check" size={12} /> : null}
            </span>
            {reason === undefined ? null : (
              <span id={reasonId} hidden>
                {reason}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
