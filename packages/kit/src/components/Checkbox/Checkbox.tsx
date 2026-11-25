import { useEffect, useRef } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { useFieldControl } from '../FormControl/useFieldControl';
import { tip } from '../TooltipHost';
import styles from './Checkbox.module.css';

export type CheckboxProps = {
  /** Whether it is checked; `'mixed'` is the dash of a choice that covers some of a set. The caller owns it. */
  readonly checked: boolean | 'mixed';
  /** Called with the other state when it is pressed, by the pointer or by Space: a click on a mixed box asks for `true`. */
  readonly onCheckedChange: (checked: boolean) => void;
  /** The text after the box, which names it and takes the click. Without it the box is bare: a Field's label names it, or `label` of the Field around it. */
  readonly label?: string | undefined;
  /** The value cannot be changed. It stays focusable, and its description says why: the lane of its Field, or "Read-only." when it has none. */
  readonly readOnly?: boolean | undefined;
  /** Why the box cannot change. It stays focusable with `aria-disabled`, does nothing, and has this as its description and its tooltip. Print the same reason where the user reads the page. */
  readonly disabledReason?: string | undefined;
} & DataAttributes;

/**
 * A choice that is kept with the form's other values: a native checkbox, so Space toggles it and it is one Tab stop. The box is a 16 px mark in a
 * 24 px target; with a `label` the text is part of the target. Props are closed: no `className`, no `style`; `data-*` passes through to the input.
 */
export function Checkbox({ checked, onCheckedChange, label, readOnly, disabledReason, ...rest }: CheckboxProps) {
  const control = useFieldControl({ label: undefined, invalid: undefined, readOnly, disabledReason: disabledReason ?? (readOnly === true ? 'Read-only.' : undefined) });
  const input = useRef<HTMLInputElement | null>(null);
  const mixed = checked === 'mixed';

  // `indeterminate` is a DOM property with no attribute.
  useEffect(() => {
    if (input.current !== null) {
      input.current.indeterminate = mixed;
    }
  }, [mixed]);

  const box = (
    <input
      {...dataAttributes(rest)}
      {...dataAttributes(label === undefined ? tip(control.reason) : {})}
      ref={input}
      id={control.id}
      type="checkbox"
      className={styles.box}
      checked={checked === true}
      aria-describedby={control.describedBy}
      aria-disabled={control.locked ? 'true' : undefined}
      onChange={() => {
        if (!control.locked) {
          onCheckedChange(checked !== true);
        }
      }}
    />
  );
  const reason =
    control.reasonId === undefined ? null : (
      <span id={control.reasonId} hidden>
        {control.reason}
      </span>
    );

  if (label === undefined) {
    return (
      <>
        {box}
        {reason}
      </>
    );
  }

  return (
    <>
      <label {...dataAttributes(tip(control.reason))} className={styles.root} data-ov-locked={control.locked ? 'true' : undefined}>
        {box}
        <span className={styles.text}>{label}</span>
      </label>
      {reason}
    </>
  );
}
