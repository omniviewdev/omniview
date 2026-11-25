import { useId, useState } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import type { ButtonTone } from '../Button';
import { Field } from '../Field';
import { FormActions } from '../FormActions';
import { Icon, type IconName } from '../Icon';
import { Sheet } from '../Sheet';
import { Status, type StatusRole } from '../Status';
import { TextInput } from '../TextInput';
import styles from './ConfirmDialog.module.css';

/** The object the action is on: what it is called, what it is, and what state it is in. */
export type ConfirmSubject = {
  /** Its name, in bold. With the destructive tier it is the text to type. */
  readonly name: string;
  /** What it is ("Connection"): the first words of a muted line under the name. */
  readonly kind?: string | undefined;
  /** More about it, after the kind in the same line: "Region 1 · production". */
  readonly meta?: string | undefined;
  /** Its state, at the end of the row, in the platform's own word. */
  readonly status?: { readonly role: StatusRole; readonly label: string } | undefined;
};

type ConfirmBase = {
  /** The verb phrase that says what is asked ("Remove connection"). It names the dialog. */
  readonly title: string;
  /** A glyph in the tile before the title. */
  readonly icon?: IconName | undefined;
  /** What happens if the person confirms, in one line. It describes the dialog: a screen reader reads it after the title. Never a question, and never a consent checkbox. */
  readonly message: string;
  /** The verb of the confirm command and only the verb ("Remove", never "Remove 3"). */
  readonly confirmLabel: string;
  /** `danger` fills the confirm command with the error role and starts the focus on Cancel, so that Enter is the safe answer. Otherwise the focus starts on the confirm command. */
  readonly tone?: ButtonTone | undefined;
  /** The confirmed operation is running: the confirm command is busy and does nothing until it ends. Cancel and Close still ask to leave. */
  readonly busy?: boolean | undefined;
  /** Why the operation failed, in one line at the start of the footer. The dialog stays open: the person tries again or leaves. */
  readonly error?: string | undefined;
  readonly onConfirm: () => void;
  /** The person leaves without confirming: Cancel, Close or Escape. The dialog never closes itself: mounting is opening, so the caller stops rendering it. */
  readonly onCancel: () => void;
} & DataAttributes;

/** `plain` confirms in one press. `destructive` (a cascade, or an action with no way back) needs a subject: its name must be typed before the confirm command works. */
export type ConfirmDialogProps = ConfirmBase &
  (
    | {
      /** Confirms in one press. */
      readonly tier?: 'plain' | undefined;
      /** The object the action is on: its name, kind and state, above the message. Absent, the dialog is a message and a verb. */
      readonly subject?: ConfirmSubject | undefined;
    }
    | {
      /** Asks for the subject's name to be typed first: the confirm command does nothing until it matches, and the field has the focus. */
      readonly tier: 'destructive';
      /** The object the action is on. Its name is the text to type. */
      readonly subject: ConfirmSubject;
    }
  );

/**
 * The confirmation of an action, in the anatomy of the design (CT1, the mock's `H.recordDialog`): a narrow `Sheet` whose header is the verb phrase, whose body says who it is about, in one line what happens, and for the
 * destructive tier asks for the name, and whose footer is a `FormActions` with Cancel and the verb. A confirm command that is busy, or that waits for the name, does nothing and says why. Where the focus starts is the
 * dialog's decision, taken in the effects of its own content, never of the surface it is shown on: the name field, else Cancel for a danger tone, else the confirm command. Mounting is opening and unmounting is closing, so
 * the caller owns whether it is open, and what is typed goes with the dialog. Props are closed: no `className`, no `style`; `data-*` passes through to the dialog.
 */
export function ConfirmDialog({ title, icon, subject, tier, message, confirmLabel, tone = 'neutral', busy, error, onConfirm, onCancel, ...rest }: ConfirmDialogProps) {
  const messageId = useId();
  const [typed, setTyped] = useState('');
  const phrase = tier === 'destructive' ? subject?.name : undefined;
  const isMismatch = phrase !== undefined && typed.trim() !== phrase;
  const isBusy = busy === true;
  const disabledReason = isBusy ? 'Working' : isMismatch ? `Type ${phrase} to enable ${confirmLabel}` : undefined;
  const safeAnswer = tone === 'danger' ? 'cancel' : 'primary';
  const kindLine = subject === undefined ? '' : [subject.kind, subject.meta].filter((part) => part !== undefined && part !== '').join(' · ');

  return (
    <Sheet
      {...dataAttributes(rest)}
      title={title}
      icon={icon}
      size="narrow"
      describedBy={messageId}
      onClose={onCancel}
      footer={
        <FormActions
          lead={
            error === undefined ? undefined : (
              <span className={styles.error} role="alert" data-ov-part="error">
                <Icon name="status-error" />
                {error}
              </span>
            )
          }
          cancel={{ label: 'Cancel', onSelect: onCancel }}
          primary={{ label: confirmLabel, onSelect: onConfirm, busy, disabledReason }}
          tone={tone}
          autoFocus={phrase === undefined ? safeAnswer : undefined}
        />
      }
    >
      <div className={styles.body} data-ov-part="content">
        {subject === undefined ? null : (
          <div className={styles.identity} data-ov-part="subject">
            <div className={styles.who}>
              <strong className={styles.name}>{subject.name}</strong>
              {kindLine === '' ? null : <span className={styles.kind}>{kindLine}</span>}
            </div>
            {subject.status === undefined ? null : <Status role={subject.status.role}>{subject.status.label}</Status>}
          </div>
        )}
        <p id={messageId} className={styles.message} data-ov-part="message">
          {message}
        </p>
        {phrase === undefined ? null : (
          <Field
            label={`Type ${phrase} to confirm`}
            layout="stacked"
            lane
            message={isMismatch ? { kind: 'hint', text: `${confirmLabel} stays off until the name matches.` } : undefined}
          >
            <TextInput
              mono
              autoFocus
              value={typed}
              onValueChange={setTyped}
              onCommit={() => {
                // Enter confirms once the name matches, as the confirm command does: the same two reasons keep it from running.
                if (!isMismatch && !isBusy) {
                  onConfirm();
                }
              }}
            />
          </Field>
        )}
      </div>
    </Sheet>
  );
}
