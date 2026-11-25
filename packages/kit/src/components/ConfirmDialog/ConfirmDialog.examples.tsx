import { Button, ConfirmDialog, type ConfirmSubject } from '@omniviewdev/kit';
import { useState, type ReactNode } from 'react';

// Confirmations written the way a consumer writes them: the caller owns whether one is open, because mounting is opening and the dialog never closes itself, and what is typed goes with the dialog. An open modal makes the
// whole page inert, so nothing opens at load: press the button.

const SUBJECT: ConfirmSubject = { name: 'Connection A', kind: 'Connection', meta: 'Region 1 · production', status: { role: 'healthy', label: 'Connected' } };

/** The button that opens a dialog, and the dialog while it is open. The button takes the focus as it is pressed (a Mac browser does not focus a button that was pressed), and gets it back when the dialog closes. */
function Demo({ label, children }: { readonly label: string; readonly children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {open
        ? children(() => {
          setOpen(false);
        })
        : null}
    </>
  );
}

/** A plain confirmation: who it is about, in one line what happens, and the verb. The focus starts on the verb, so Enter confirms. */
export const Plain = () => (
  <Demo label="Open confirmation">
    {(close) => (
      <ConfirmDialog
        title="Disconnect"
        icon="server"
        subject={SUBJECT}
        message="Stops browsing Connection A. You can connect again at any time."
        confirmLabel="Disconnect"
        onConfirm={close}
        onCancel={close}
      />
    )}
  </Demo>
);

/** A danger confirmation fills the verb with the error role and starts the focus on Cancel, so that Enter is the safe answer. */
export const Danger = () => (
  <Demo label="Open danger confirmation">
    {(close) => (
      <ConfirmDialog
        title="Remove connection"
        icon="trash"
        tone="danger"
        subject={SUBJECT}
        message="Removes Connection A from your list. Nothing it points to is changed."
        confirmLabel="Remove"
        onConfirm={close}
        onCancel={close}
      />
    )}
  </Demo>
);

/** The destructive tier asks for the name to be typed: the verb stays off, and says why, until the name matches. The field has the focus, and Enter in it confirms once the name matches. */
export const DestructiveWithTypedName = () => (
  <Demo label="Open destructive confirmation">
    {(close) => (
      <ConfirmDialog
        title="Delete connection"
        icon="trash"
        tone="danger"
        tier="destructive"
        subject={SUBJECT}
        message="Deletes Connection A and everything stored under it. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={close}
        onCancel={close}
      />
    )}
  </Demo>
);

/** The confirmed operation is running: the verb is busy and does nothing until it ends, and Cancel still leaves. */
export const Busy = () => (
  <Demo label="Open confirmation that is busy">
    {(close) => (
      <ConfirmDialog
        title="Remove connection"
        icon="trash"
        tone="danger"
        busy
        subject={SUBJECT}
        message="Removes Connection A from your list. Nothing it points to is changed."
        confirmLabel="Remove"
        onConfirm={close}
        onCancel={close}
      />
    )}
  </Demo>
);

/** The operation failed: the reason is one line at the start of the footer, and the dialog stays open so that the person tries again or leaves. */
export const WithError = () => (
  <Demo label="Open confirmation with an error">
    {(close) => (
      <ConfirmDialog
        title="Remove connection"
        icon="trash"
        tone="danger"
        error="Could not remove the connection. Try again."
        subject={SUBJECT}
        message="Removes Connection A from your list. Nothing it points to is changed."
        confirmLabel="Remove"
        onConfirm={close}
        onCancel={close}
      />
    )}
  </Demo>
);

/** Without a subject the dialog is a message and a verb, for a question that is not about one object. */
export const WithoutSubject = () => (
  <Demo label="Open confirmation without a subject">
    {(close) => (
      <ConfirmDialog
        title="Discard changes"
        message="The changes to this item are lost, and the item goes back to how it was saved."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={close}
        onCancel={close}
      />
    )}
  </Demo>
);
