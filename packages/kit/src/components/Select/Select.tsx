import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import faceStyles from '../FormControl/control.module.css';
import { useFieldControl } from '../FormControl/useFieldControl';
import { Icon } from '../Icon';
import styles from './Select.module.css';

export type SelectOption = {
  /** What the field holds when this option is chosen. */
  readonly value: string;
  /** What the option says: plain text (an option holds no markup). */
  readonly label: string;
  /** The option stays in the list, announced as unavailable, and cannot be chosen. */
  readonly disabled?: boolean | undefined;
};

/** `normal` is a select in a settings row: at least the mock's 200 px, as wide as its longest option needs. `fill` takes the width of its place. */
export type SelectWidth = 'normal' | 'fill';

export type SelectProps = {
  /** The value of the option that is chosen. The caller owns it. */
  readonly value: string;
  /** Called with the value of the option that was chosen. A select applies at once (design S125). */
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  /** What the select says while nothing is chosen (the value is empty, or none of the options): a word that cannot be chosen again. */
  readonly placeholder?: string | undefined;
  /** The accessible name when the select has no Field around it; inside a Field the Field's label names it. */
  readonly label?: string | undefined;
  readonly width?: SelectWidth | undefined;
  /** An identifier: the code face. */
  readonly mono?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  /** The value is a fact that cannot be changed: it does not open and does not change (design 14 F-4). */
  readonly readOnly?: boolean | undefined;
  /** Why the select cannot change. It stays focusable with `aria-disabled`, does not open or change, and has this as its description. Print the same reason in the lane (design P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
} & DataAttributes;

/**
 * A single choice among a few values, in the native select (the mock's `H.select`: "a themed native select for the choice that a segmented
 * value or a set of cards does not fit", design 04 section 2): the face of an input with the arrow drawn by the part, and the platform's
 * own popup and keyboard (design 04: a dropdown keeps the native select's keyboard model). Controlled. Props are closed: no `className`, no
 * `style`; `data-*` passes through to the select.
 */
export function Select({ value, onValueChange, options, placeholder, label, width = 'fill', mono, invalid, readOnly, disabledReason, ...rest }: SelectProps) {
  // The mock paints and exposes a read-only select as an unavailable one (`lockControls`, core.js:188: any control but a text field is `aria-disabled`).
  const control = useFieldControl({ label, invalid, readOnly, disabledReason: disabledReason ?? (readOnly === true ? 'Read-only.' : undefined) });
  // A value that matches no option shows the placeholder, whatever the caller holds: the select must not say that another option is chosen.
  const shown = placeholder !== undefined && !options.some((option) => option.value === value) ? '' : value;

  return (
    <span className={styles.root} data-ov-part="select" data-ov-width={width}>
      <select
        {...dataAttributes(rest)}
        id={control.id}
        className={`${faceStyles.face} ${styles.select}`}
        value={shown}
        required={control.required}
        data-ov-mono={mono === true ? 'true' : undefined}
        data-ov-validation={control.warning ? 'warning' : undefined}
        aria-label={control.ariaLabel}
        aria-describedby={control.describedBy}
        aria-invalid={control.invalid ? 'true' : undefined}
        aria-disabled={control.locked ? 'true' : undefined}
        onChange={(event) => {
          if (!control.locked) {
            onValueChange(event.target.value);
          }
        }}
        onMouseDown={(event) => {
          // A select that cannot change does not open.
          if (control.locked) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          // ...and none of its keys changes it or opens it: only Tab (to leave it) and Escape (for the dialog or page) are left.
          if (control.locked && event.key !== 'Tab' && event.key !== 'Escape') {
            event.preventDefault();
          }
        }}
      >
        {placeholder === undefined ? null : (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <span className={styles.chevron} aria-hidden="true">
        <Icon name="chevron-down" size={12} />
      </span>
      {control.reasonId === undefined ? null : (
        <span id={control.reasonId} hidden>
          {control.reason}
        </span>
      )}
    </span>
  );
}
