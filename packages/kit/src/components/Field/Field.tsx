import { useId, type ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { FieldContext, type FieldContextValue } from '../FormControl/fieldContext';
import { FieldLane } from './FieldLane';
import { pick, type FieldMessage } from './message';
import styles from './Field.module.css';

/**
 * `aligned` puts the label in a track of its own beside the control; `stacked` puts it above, for a long or constrained control; `row` is a
 * settings row: the title, the description and the message lane in a column on one side, and the control with a trailing slot on the other
 * (design 16 S126, 14 F-5).
 */
export type FieldLayout = 'aligned' | 'stacked' | 'row';

export type FieldProps = {
  /** The visible name of the field, a real `<label for>` of its control. A noun phrase, in sentence case, without a colon. In a row it is the title. */
  readonly label: string;
  /** The control: TextInput, NumberInput, Toggle, Select or SecretInput. It takes its id, its description, its invalid state and its lock from the field. */
  readonly children: ReactNode;
  /** The field must have a value: the asterisk after the label (which assistive technology does not read) and `required` on the control. */
  readonly required?: boolean | undefined;
  /** A short muted word after the label: "optional", a unit, a range. */
  readonly aside?: string | undefined;
  /**
   * A muted line that says what the field is for, always shown; the control is described by it. Keep it to one sentence. Under the control in the other
   * layouts; in a row it is the description under the title, clamped to two lines, and its whole text is the tooltip while it is cut.
   */
  readonly help?: string | undefined;
  /** The one message of the lane (design S127): the model's message of the field. */
  readonly message?: FieldMessage | undefined;
  /** The field can say something about its value (it validates, needs a restart or is checked): the 16 px lane stays under the control (in a row, under the description) in every state. */
  readonly lane?: boolean | undefined;
  /** Retry, for a message that offers it: what could not be checked or applied is asked again. */
  readonly onRetry?: (() => void) | undefined;
  /** Why the field cannot change. The control stays focusable with `aria-disabled` and does nothing, and the lane prints this reason (design P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
  /** The value is a fact that cannot be changed: selectable, not dimmed (design 14 F-4). The lane says why in its message. */
  readonly readOnly?: boolean | undefined;
} & DataAttributes &
  (
    | {
      readonly layout?: Exclude<FieldLayout, 'row'> | undefined;
      /** Only a row has a trailing slot: with any other layout it is a type error. */
      readonly trailing?: undefined;
    }
    | {
      readonly layout: 'row';
      /**
       * What stands at the end of the row, in a slot of 24 by 24 px that is held in every state, empty or not, so that what it comes to hold moves nothing:
       * a command for the value, a status. The row says nothing of what it holds and decides nothing about when it shows.
       */
      readonly trailing?: ReactNode;
    }
  );

/**
 * One field of a form (design 14 F-3, 12 section 13): a persistent label, the control, a muted help line and the message lane, tied
 * together: the label is a real `<label for>`, the control is described by the help and the lane, marked invalid by an error and required
 * when the field is. Aligned, the label is in a track of 96 to 140 px beside the control, 6 px apart; stacked, it is above. A row (design 16
 * S126) is a settings row: the title, the description and the lane in a text column, then the control and its trailing slot in a column of
 * their own, on one line whose height is its content's, a message or a state change never altering it. The field holds no value and decides
 * nothing: the model says the message, the control says the value. Props are closed: no `className`, no `style`; `data-*` passes through to the root.
 */
export function Field({ label, children, required, aside, layout = 'aligned', trailing, help, message, lane, onRetry, disabledReason, readOnly, ...rest }: FieldProps) {
  const base = useId();
  const reason = disabledReason === undefined || disabledReason.trim() === '' ? undefined : disabledReason;
  const shown = pick(message, reason);
  // The lane prints the reason only when no message outranks it: a control unavailable for it describes the reason itself otherwise.
  const reasonShown = reason !== undefined && shown?.text === reason;
  const reserved = lane === true || shown !== undefined;
  const helpId = `${base}-help`;
  const laneId = `${base}-lane`;
  const describedBy = [help === undefined || help === '' ? undefined : helpId, reserved ? laneId : undefined].filter((id) => id !== undefined).join(' ');
  const context: FieldContextValue = {
    controlId: `${base}-control`,
    labelId: `${base}-label`,
    label,
    describedBy: describedBy === '' ? undefined : describedBy,
    invalid: shown?.kind === 'error',
    warning: shown?.kind === 'warning',
    required: required === true,
    disabledReason: reason,
    reasonShown,
    readOnly: readOnly === true,
  };

  const row = layout === 'row';
  const title = (
    <label id={context.labelId} htmlFor={context.controlId} className={styles.label} data-ov-part="label">
      {label}
      {required === true ? (
        <span className={styles.required} data-ov-part="required" aria-hidden="true">
          *
        </span>
      ) : null}
      {aside === undefined || aside === '' ? null : (
        // A space of its own, so that the name of the control reads "Prefix optional" and not "Prefixoptional".
        <>
          {' '}
          <span className={styles.aside} data-ov-part="aside">
            {aside}
          </span>
        </>
      )}
    </label>
  );
  const description =
    help === undefined || help === '' ? null : (
      // A row clamps its description to two lines, and the tooltip host shows all of it while it is cut.
      <div id={helpId} className={styles.help} data-ov-part="help" data-ov-clip={row ? '' : undefined}>
        {help}
      </div>
    );
  const messageLane = reserved ? <FieldLane id={laneId} message={shown} onRetry={onRetry} /> : null;

  return (
    <FieldContext value={context}>
      <div {...dataAttributes(rest)} className={styles.root} data-ov-layout={layout} data-ov-unavailable={reason === undefined ? undefined : 'true'}>
        {row ? (
          <>
            <div className={styles.text} data-ov-part="text">
              {title}
              {description}
              {messageLane}
            </div>
            <div className={styles.control} data-ov-part="control">
              {children}
              <div className={styles.trailing} data-ov-part="trailing">
                {trailing}
              </div>
            </div>
          </>
        ) : (
          <>
            {title}
            {children}
            {description}
            {messageLane}
          </>
        )}
      </div>
    </FieldContext>
  );
}
