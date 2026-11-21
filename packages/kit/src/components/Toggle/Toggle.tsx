import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { useFieldControl } from '../FormControl/useFieldControl';
import styles from './Toggle.module.css';

export type ToggleProps = {
  /** Whether it is on. The caller owns it: a switch applies at once (design S125), so the value is the model's, not the part's. */
  readonly checked: boolean;
  /** Called with the other state when it is pressed, by the pointer or by Enter or Space. */
  readonly onCheckedChange: (checked: boolean) => void;
  /** The accessible name when the switch has no Field around it; inside a Field the Field's label names it. One name for both states: it never says On or Off. */
  readonly label?: string | undefined;
  /**
   * The value cannot be changed. The mock paints and exposes it as an unavailable switch (`lockControls`, core.js:188: any control but a text field is
   * `aria-disabled`): a switch that looks pressable and does nothing is a dead control. It stays focusable, and its description says why: the lane of
   * its Field, or "Read-only." when it has none.
   */
  readonly readOnly?: boolean | undefined;
  /** Why the switch cannot change. It stays focusable with `aria-disabled`, does nothing, and has this as its description. Print the same reason in the lane (design P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
} & DataAttributes;

/**
 * A switch for a value that applies at once (the mock's `H.switch`, design 04 section 6): a native button with the switch role around a
 * 26 by 16 px track, 34 by 24 px in all. It is one tab stop, and Enter and Space press it as they press any button. Props are closed: no
 * `className`, no `style`; `data-*` passes through to the button.
 */
export function Toggle({ checked, onCheckedChange, label, readOnly, disabledReason, ...rest }: ToggleProps) {
  const control = useFieldControl({ label, invalid: undefined, readOnly, disabledReason: disabledReason ?? (readOnly === true ? 'Read-only.' : undefined) });

  return (
    <button
      {...dataAttributes(rest)}
      id={control.id}
      type="button"
      role="switch"
      className={styles.root}
      aria-checked={checked}
      aria-label={control.ariaLabel}
      aria-describedby={control.describedBy}
      aria-disabled={control.locked ? 'true' : undefined}
      onClick={(event) => {
        if (control.locked) {
          event.preventDefault();
          return;
        }

        onCheckedChange(!checked);
      }}
    >
      <span className={styles.track} data-ov-part="track" aria-hidden="true" />
      {control.reasonId === undefined ? null : (
        <span id={control.reasonId} hidden>
          {control.reason}
        </span>
      )}
    </button>
  );
}
