import { useEffect, useRef, type ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Button, type ButtonTone } from '../Button';
import type { IconName } from '../Icon';
import styles from './FormActions.module.css';

/** One command of the lane. */
export type FormAction = {
  /** The label: a verb in sentence case ("Save", "Remove"), never a verb with a count. It names the button. */
  readonly label: string;
  readonly onSelect: () => void;
  /** A 16 px glyph before the label. Decoration: the label is the name. */
  readonly icon?: IconName | undefined;
  /** Why the command is unavailable. The button stays a Tab stop with `aria-disabled`, does nothing, and has this as its description: print the same reason where the person reads the page. */
  readonly disabledReason?: string | undefined;
  /** The command's own request is in flight: `aria-busy` at once, and after a second the icon becomes the loader. The label never changes and input is not blocked. */
  readonly busy?: boolean | undefined;
};

/** The command that leaves without doing anything. Its label says how: "Cancel" beside other commands, "Close" alone, "Done". */
export type FormCancel = {
  readonly label: string;
  readonly onSelect: () => void;
};

export type FormActionsProps = {
  /** The command the form is for: last in the lane, and filled. */
  readonly primary?: FormAction | undefined;
  /** Other commands, between Cancel and the primary: two at the most. */
  readonly secondary?: readonly FormAction[] | undefined;
  /** First of the commands. Absent, the lane has no Cancel. */
  readonly cancel?: FormCancel | undefined;
  /** `danger` fills the primary with the error role: the command removes or loses something. */
  readonly tone?: ButtonTone | undefined;
  /** What stands at the start of the lane, which pushes the commands to the end: a short muted note, the state of an operation. */
  readonly lead?: ReactNode;
  /** The command that takes the focus when the lane mounts: Cancel, where the safe answer should be under Enter, or the primary. Use it only inside a dialog, never on a page. */
  readonly autoFocus?: 'cancel' | 'primary' | undefined;
} & DataAttributes;

type CommandProps = {
  readonly action: FormAction;
  readonly variant: 'secondary' | 'primary';
  readonly tone?: ButtonTone | undefined;
};

function Command({ action, variant, tone }: CommandProps) {
  return (
    <Button
      variant={variant}
      tone={tone}
      icon={action.icon}
      busy={action.busy}
      disabledReason={action.disabledReason}
      data-ov-part={variant}
      onClick={() => {
        action.onSelect();
      }}
    >
      {action.label}
    </Button>
  );
}

/**
 * The lane of the commands of a dialog, a drawer or a form (the mock's `H.formActions`): the lead, Cancel, the secondary commands, and the primary last, at the end of the lane, 12 px apart, wrapping when they do
 * not fit. Every command is a `Button` and a Tab stop, a labelled one at least 72 px wide; a command that cannot run says why and stays in the Tab order. It is a group with no label of its own: the dialog or form
 * around it is what it belongs to, and the lane knows nothing of it, so it works in a dialog, in a window of its own, or at the foot of a page. Props are closed: no `className`, no `style`; `data-*` passes to the group.
 */
export function FormActions({ primary, secondary, cancel, tone = 'neutral', lead, autoFocus, ...rest }: FormActionsProps) {
  const root = useRef<HTMLDivElement>(null);

  // The focus is taken in the lane's own effect, as a field takes it: what presents the lane may open itself in its own layout effect, and a control of a surface that is not open yet cannot take the focus.
  useEffect(() => {
    if (autoFocus !== undefined) {
      root.current?.querySelector<HTMLElement>(`[data-ov-part="${autoFocus}"]`)?.focus();
    }
  }, [autoFocus]);

  const hasLead = lead !== undefined && lead !== null && typeof lead !== 'boolean';
  return (
    <div {...dataAttributes(rest)} ref={root} className={styles.root} role="group" data-ov-part="actions">
      {hasLead ? (
        <div className={styles.lead} data-ov-part="lead">
          {lead}
        </div>
      ) : null}
      {cancel === undefined ? null : (
        <Button
          data-ov-part="cancel"
          onClick={() => {
            cancel.onSelect();
          }}
        >
          {cancel.label}
        </Button>
      )}
      {secondary?.map((action) => <Command key={action.label} action={action} variant="secondary" />)}
      {primary === undefined ? null : <Command action={primary} variant="primary" tone={tone} />}
    </div>
  );
}
