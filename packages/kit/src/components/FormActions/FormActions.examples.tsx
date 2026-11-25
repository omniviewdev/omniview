import { Button, Field, FormActions, Sheet, Stack, Text, TextInput } from '@omniviewdev/kit';
import { useState, type ReactNode } from 'react';

// The lane is shown on its own first, as it stands at the foot of a form, and then in the footer of a `Sheet` at each of its sizes: the sheet is one more place for the lane, and the lane knows nothing of it. A sheet is a modal,
// and an open modal makes the whole page inert, so nothing opens at load: press the button. Mounting is opening, so the caller owns whether a sheet is open, and the draft of a field lives above the sheet.
const nothing = () => undefined;

/** Cancel, and the primary command last: the lane of a dialog or a form, its commands at the end. */
export const CancelAndPrimary = () => <FormActions cancel={{ label: 'Cancel', onSelect: nothing }} primary={{ label: 'Save', onSelect: nothing }} />;

/** A secondary command sits between Cancel and the primary, which is always last. */
export const WithSecondary = () => (
  <FormActions
    cancel={{ label: 'Cancel', onSelect: nothing }}
    secondary={[{ label: 'Save draft', onSelect: nothing }]}
    primary={{ label: 'Publish', onSelect: nothing }}
  />
);

/** The lead says something short at the start of the lane and pushes the commands to the end. */
export const WithLead = () => (
  <FormActions lead="2 changes are not saved" cancel={{ label: 'Cancel', onSelect: nothing }} primary={{ label: 'Save', onSelect: nothing }} />
);

/** A danger lane fills the primary with the error role: the command removes or loses something. */
export const Danger = () => (
  <FormActions tone="danger" cancel={{ label: 'Cancel', onSelect: nothing }} primary={{ label: 'Remove', icon: 'trash', onSelect: nothing }} />
);

/** A primary that cannot run says why, stays a Tab stop and does nothing: the reason is its description. */
export const PrimaryDisabledWithReason = () => (
  <FormActions cancel={{ label: 'Cancel', onSelect: nothing }} primary={{ label: 'Create', disabledReason: 'Enter a name first', onSelect: nothing }} />
);

/** The primary's own request is running: aria-busy now, and the loader in place of its icon after a second. The label does not change. */
export const PrimaryBusy = () => (
  <FormActions cancel={{ label: 'Cancel', onSelect: nothing }} primary={{ label: 'Create', icon: 'check', busy: true, onSelect: nothing }} />
);

/** A lane with nothing to confirm has one command, which leaves: it is called Close. */
export const CloseAlone = () => <FormActions cancel={{ label: 'Close', onSelect: nothing }} />;

/** The button that opens a sheet, and the sheet while it is open. The button takes the focus as it is pressed (a Mac browser does not focus a button that was pressed), and gets it back when the sheet closes. */
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

/** A narrow sheet, 440 px wide and as high as its content: one question, and its answer in the footer. The field takes the focus when the sheet opens, and Close does not. */
export const InNarrowSheet = () => {
  const [name, setName] = useState('Item A');
  return (
    <Demo label="Open narrow sheet">
      {(close) => (
        <Sheet
          title="Rename item"
          size="narrow"
          onClose={close}
          footer={<FormActions cancel={{ label: 'Cancel', onSelect: close }} primary={{ label: 'Rename', onSelect: close }} />}
        >
          <Field label="Name" layout="stacked">
            <TextInput autoFocus value={name} onValueChange={setName} />
          </Field>
        </Sheet>
      )}
    </Demo>
  );
};

/** The standard sheet, 640 px wide, is the default size. The primary says why it cannot run until the first field has a name. */
export const InStandardSheet = () => {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  return (
    <Demo label="Open standard sheet">
      {(close) => (
        <Sheet
          title="Create item"
          icon="plus"
          onClose={close}
          footer={
            <FormActions
              cancel={{ label: 'Cancel', onSelect: close }}
              primary={{ label: 'Create', onSelect: close, disabledReason: name.trim() === '' ? 'Enter a name first' : undefined }}
            />
          }
        >
          <Stack gap={12}>
            <Field label="Name" layout="stacked" required>
              <TextInput autoFocus value={name} onValueChange={setName} />
            </Field>
            <Field label="Note" layout="stacked" aside="optional">
              <TextInput value={note} onValueChange={setNote} />
            </Field>
          </Stack>
        </Sheet>
      )}
    </Demo>
  );
};

/** A wide sheet, 900 px, for a form with its labels beside its controls. */
export const InWideSheet = () => {
  const [name, setName] = useState('Item A');
  const [address, setAddress] = useState('https://api.example.test');
  return (
    <Demo label="Open wide sheet">
      {(close) => (
        <Sheet
          title="Edit item"
          size="wide"
          onClose={close}
          footer={<FormActions cancel={{ label: 'Cancel', onSelect: close }} primary={{ label: 'Save', onSelect: close }} />}
        >
          <Stack gap={12}>
            <Field label="Name">
              <TextInput value={name} onValueChange={setName} />
            </Field>
            <Field label="Address">
              <TextInput mono value={address} onValueChange={setAddress} />
            </Field>
          </Stack>
        </Sheet>
      )}
    </Demo>
  );
};

/** An icon tile before the title and a muted line under it, which says what the sheet is about. The tile is decoration: the title names the dialog. */
export const InSheetWithIconAndMeta = () => (
  <Demo label="Open sheet with an icon">
    {(close) => (
      <Sheet
        title="Edit connection"
        icon="server"
        meta="Connection A · production"
        onClose={close}
        footer={<FormActions cancel={{ label: 'Close', onSelect: close }} />}
      >
        <Text as="p">The details of the connection are shown here, under a header that names it.</Text>
      </Sheet>
    )}
  </Demo>
);

const LINES = Array.from({ length: 40 }, (_, index) => `Line ${String(index + 1)} of a body that is longer than the window.`);

/** A body that is longer than the window is the one thing that scrolls: the header stays above it, and the footer with its lead stays below it. */
export const InSheetWithLongBody = () => (
  <Demo label="Open sheet with a long body">
    {(close) => (
      <Sheet
        title="Release notes"
        onClose={close}
        footer={<FormActions lead="Scroll to read all of it" cancel={{ label: 'Close', onSelect: close }} primary={{ label: 'Accept', onSelect: close }} />}
      >
        <Stack gap={8}>
          {LINES.map((line) => (
            <Text as="p" key={line}>
              {line}
            </Text>
          ))}
        </Stack>
      </Sheet>
    )}
  </Demo>
);
