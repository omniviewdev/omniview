import { createContext, useContext } from 'react';

/**
 * What a Field tells the control inside it: the ids that tie the label, the control and the lane together, and the state the lane already
 * says. A control with no Field around it gets `undefined` and names and describes itself.
 */
export type FieldContextValue = {
  /** The id of the control that the label is for. */
  readonly controlId: string;
  readonly labelId: string;
  /** The text of the label: a control names its own buttons with it ("Show API token"). */
  readonly label: string;
  /** The ids of the help and of the lane, for `aria-describedby`. */
  readonly describedBy: string | undefined;
  /** The lane says an error: the control is invalid. */
  readonly invalid: boolean;
  /** The lane says a warning: the control is painted for it and is not invalid, for a warning never blocks. */
  readonly warning: boolean;
  readonly required: boolean;
  /** Why the field cannot change; the lane prints it. */
  readonly disabledReason: string | undefined;
  readonly readOnly: boolean;
};

export const FieldContext = createContext<FieldContextValue | undefined>(undefined);

/** The Field around the calling control, or `undefined`. */
export const useField = (): FieldContextValue | undefined => useContext(FieldContext);
