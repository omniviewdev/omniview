import { useId } from 'react';
import { useField } from './fieldContext';

type ControlInput = {
  /** The accessible name when the control has no Field around it. */
  readonly label: string | undefined;
  readonly invalid: boolean | undefined;
  readonly readOnly: boolean | undefined;
  /** Why the control cannot change. Empty is no reason. */
  readonly disabledReason: string | undefined;
};

/** What a control needs to name, describe and lock itself, from its own props and the Field around it. */
export type FieldControl = {
  readonly id: string;
  /** `aria-label`: the control's own name, only when no Field labels it. */
  readonly ariaLabel: string | undefined;
  /** The name of the field, for the buttons that belong to the control ("Decrease Font size"). */
  readonly name: string | undefined;
  /** The id of the Field's label, which names a group of controls. */
  readonly labelId: string | undefined;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly warning: boolean;
  readonly required: boolean;
  readonly readOnly: boolean;
  /** Why the control is unavailable, from the control or from its Field; undefined when it is available. */
  readonly reason: string | undefined;
  /** The id of the hidden element that describes the control by its own reason: undefined when its Field already prints the reason. */
  readonly reasonId: string | undefined;
  /** The control cannot change: it is unavailable for a reason, or read-only. */
  readonly locked: boolean;
};

const reasonOf = (text: string | undefined): string | undefined => (text === undefined || text.trim() === '' ? undefined : text);

/**
 * What every control of a form shares. A control inside a Field is named by the Field's label, described by its help and lane, and
 * unavailable or read-only when the Field says so; the reason is printed by the Field's lane, so the control adds no second description of it.
 * A control on its own names itself with `label` and describes itself by its own reason (design P2, DR1, 04 DR1).
 */
export function useFieldControl({ label, invalid, readOnly, disabledReason }: ControlInput): FieldControl {
  const field = useField();
  const ownId = useId();
  const reasonId = useId();
  const own = reasonOf(disabledReason);
  const reason = own ?? field?.disabledReason;
  // Printed by the Field already when it holds the same words; described by the control otherwise, so that no reason is ever left unsaid.
  const described = own !== undefined && own !== field?.disabledReason;
  const describedBy = [field?.describedBy, described ? reasonId : undefined].filter((id) => id !== undefined).join(' ');
  const isReadOnly = readOnly === true || field?.readOnly === true;

  return {
    id: field?.controlId ?? ownId,
    ariaLabel: field === undefined ? label : undefined,
    name: field?.label ?? label,
    labelId: field?.labelId,
    describedBy: describedBy === '' ? undefined : describedBy,
    invalid: invalid === true || field?.invalid === true,
    warning: field?.warning === true,
    required: field?.required === true,
    readOnly: isReadOnly,
    reason,
    reasonId: described ? reasonId : undefined,
    locked: reason !== undefined || isReadOnly,
  };
}
