import { useId, useRef, useState } from 'react';
import commandStyles from '../../shared/command.module.css';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { useFieldControl } from '../FormControl/useFieldControl';
import { Icon } from '../Icon';
import { tip } from '../TooltipHost';
import styles from './ValuePicker.module.css';
import { ValuePickerPopup } from './ValuePickerPopup';

export type ValuePickerOption = {
  /** What the value holds while this option is chosen. It is also the option's key, so it is unique in a picker. */
  readonly value: string;
  /** What the option says: plain text (an option holds no markup). The search reads it. */
  readonly label: string;
  /** A second line under the label, muted: a count, an identifier. The search reads it. When any option has a second line (this, or a reason), every row is two lines high. */
  readonly description?: string | undefined;
  /**
   * Why the option cannot be chosen. It stays in the list and the arrows reach it, it is `aria-disabled` and never chosen, and the reason is what the row says in its second line (in the place of
   * its description) and in its tooltip; the search reads the reason, not the description. Print the same reason where the user reads the page (design P2, 04 DR1). An empty reason is no reason.
   */
  readonly disabledReason?: string | undefined;
};

export type ValuePickerProps = {
  /** What is chosen from: the accessible name of the picker when it has no Field around it, and of its list and its search field. Inside a Field the Field's label names them. */
  readonly label: string;
  readonly options: readonly ValuePickerOption[];
  /** The values of the options that are chosen, in the order they were chosen. The caller owns it. */
  readonly value: readonly string[];
  /** Called with the whole choice after every change: the option that was added at its end, or the one that was left out. A choice applies at once; the popup stays open. */
  readonly onValueChange: (value: readonly string[]) => void;
  /**
   * The name of no narrowing, for a filter ("All platforms"): the first row of the list, which is chosen while nothing else is and, chosen, empties the choice; and what the trigger
   * says while the choice is empty. Without it a picker says "None selected".
   */
  readonly allOption?: string | undefined;
  /** Whether the popup has a search field. A short list can do without. */
  readonly searchable?: boolean | undefined;
  /** Why the picker cannot change. It stays focusable with `aria-disabled`, does not open, and has this as its description and its tooltip. Print the same reason where the user reads the page (design P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
} & DataAttributes;

/**
 * A choice of several values, from a list that may be long: a trigger that says what is chosen ("All platforms", "None selected", "3 selected"),
 * and a popup with a search field and a list of checkable options. It is the toolbar's filter and a form's field: inside a Field the Field's
 * label names it and its lane describes it. Controlled: the popup changes nothing itself.
 *
 * The popup is mounted only while it is open, in the top layer (so it works inside a dialog), placed against the trigger with the menus'
 * placement. Its focus is the search field's: Up and Down move through the options (and Home and End, while the field is empty), Enter chooses
 * the active option and so does Space while the field is empty, Escape closes it and gives the focus back, and what is typed narrows the list.
 * The list is a screenful of rows whatever the number of options (an engine that lays nothing out, as a test's does, mounts its first twenty rows),
 * and has one handler for all of them. Props are closed: no `className`, no `style`; `data-*` passes through to the trigger.
 */
export function ValuePicker({ label, options, value, onValueChange, allOption, searchable = true, disabledReason, ...rest }: ValuePickerProps) {
  const control = useFieldControl({ label, invalid: undefined, readOnly: undefined, disabledReason });
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const summaryId = useId();
  const [open, setOpen] = useState(false);
  // A picker that becomes unavailable while it is open closes, and does not open again when it is available.
  const [locked, setLocked] = useState(control.locked);
  if (locked !== control.locked) {
    setLocked(control.locked);
    if (control.locked) {
      setOpen(false);
    }
  }

  // The mock's multi-select trigger (`H.valuePicker`, core.js:1811) says "N selected" for one value as for many, "None selected" for an empty set and the all row's name for no narrowing: it never says the one value's label.
  const summary = value.length === 0 ? (allOption ?? 'None selected') : `${value.length} selected`;
  const describedBy = [summaryId, control.describedBy].filter((id) => id !== undefined).join(' ');

  const close = (restoreFocus: boolean) => {
    if (restoreFocus) {
      trigger.current?.focus({ preventScroll: true });
    }

    setOpen(false);
  };

  return (
    <div className={styles.root} data-ov-part="value-picker">
      <button
        {...dataAttributes(rest)}
        {...dataAttributes(tip(control.reason))}
        ref={trigger}
        id={control.id}
        type="button"
        role="combobox"
        className={`${commandStyles.root} ${styles.trigger}`}
        data-ov-variant="secondary"
        data-ov-tone="neutral"
        data-ov-size="standard"
        data-ov-validation={control.warning ? 'warning' : undefined}
        aria-label={control.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        aria-invalid={control.invalid ? 'true' : undefined}
        aria-required={control.required ? 'true' : undefined}
        aria-disabled={control.locked ? 'true' : undefined}
        onClick={() => {
          if (control.locked) {
            return;
          }

          if (open) {
            close(true);
          } else {
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          // The arrows open it, as they open a select; Enter and Space are the button's own click.
          if (!control.locked && !open && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id={summaryId} className={styles.summary}>
          {summary}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="chevron-down" />
        </span>
      </button>
      {open ? (
        <ValuePickerPopup
          anchor={trigger}
          listId={listId}
          name={control.name ?? label}
          options={options}
          value={value}
          onValueChange={onValueChange}
          allOption={allOption}
          searchable={searchable}
          onClose={close}
        />
      ) : null}
      {control.reasonId === undefined ? null : (
        <span id={control.reasonId} hidden>
          {control.reason}
        </span>
      )}
    </div>
  );
}
