import { Field, SecretInput } from '@omniviewdev/kit';
import { useState } from 'react';

// A secret written the way a consumer writes it: the model says whether one is set and whether the user has typed (or cleared) one; the text
// itself goes into the model through `onValueChange` and nowhere else, so these examples keep a boolean and never the text. The width is
// the mock's: a secret is the width of a text field of a settings row. The state that Replace opens (an empty field with Show and Cancel) is not
// an example: an example may not move the focus of the page it is on, and it is reached by pressing Replace in `Set`.

/** Nothing is saved: an empty password field that says "Not set". Show is for what is typed, and it says it cannot yet. */
export const NotSet = () => {
  const [changed, setChanged] = useState(false);
  return (
    <Field label="Auth value" layout="stacked" lane>
      <SecretInput
        presence="unset"
        changed={changed}
        width="normal"
        onValueChange={(text) => {
          setChanged(text !== '');
        }}
        onRevert={() => {
          setChanged(false);
        }}
      />
    </Field>
  );
};

/** A secret is saved and the page never shows it: an empty read-only field that says "Saved · hidden", and Replace. There is no way to show it, and no button for one. Replace opens an empty field for the new value, with Show for what is typed and Cancel; Escape cancels too. */
export const Set = () => {
  const [changed, setChanged] = useState(false);
  return (
    <Field label="API token" layout="stacked" lane>
      <SecretInput
        presence="set"
        changed={changed}
        width="normal"
        onValueChange={(text) => {
          setChanged(text !== '');
        }}
        onRevert={() => {
          setChanged(false);
        }}
      />
    </Field>
  );
};

/** A new secret that is not applied: the model holds it ("Changed"), the field never shows it, and Cancel drops it. */
export const Dirty = () => {
  const [changed, setChanged] = useState(true);
  return (
    <Field label="API token" layout="stacked" lane>
      <SecretInput
        presence="set"
        changed={changed}
        width="normal"
        onValueChange={(text) => {
          setChanged(text !== '');
        }}
        onRevert={() => {
          setChanged(false);
        }}
      />
    </Field>
  );
};

/** A check that the host is making of the new secret, which is held until it answers. */
export const Validating = () => (
  <Field label="API token" layout="stacked" message={{ kind: 'checking', text: 'Verifying the token…' }}>
    <SecretInput presence="set" changed width="normal" onValueChange={() => undefined} />
  </Field>
);

/** A secret the host refused: the typed one is kept (in memory, never on the page), the field is marked invalid, and the lane says why. */
export const Invalid = () => (
  <Field label="API token" layout="stacked" message={{ kind: 'error', text: 'Too short. Use 8 or more characters.' }}>
    <SecretInput presence="unset" changed width="normal" onValueChange={() => undefined} />
  </Field>
);

/** A check that could not be made is not an error: the secret is not applied, and Retry asks again. */
export const CouldNotCheck = () => {
  const [asked, setAsked] = useState(false);
  return (
    <Field
      label="API token"
      layout="stacked"
      message={asked ? { kind: 'checking', text: 'Verifying the token…' } : { kind: 'retry', text: '', retry: true }}
      onRetry={() => {
        setAsked(true);
      }}
    >
      <SecretInput presence="set" changed width="normal" onValueChange={() => undefined} />
    </Field>
  );
};

/** A secret that cannot be replaced says why, in its lane and as its description; the field and Replace stay focusable and do nothing. */
export const DisabledWithReason = () => (
  <Field label="API token" layout="stacked" disabledReason="Start the plugin to change this.">
    <SecretInput presence="set" changed={false} width="normal" onValueChange={() => undefined} />
  </Field>
);

/** A secret of a kind this version does not know: read-only, with nothing to replace it with. */
export const ReadOnlyNotSupported = () => (
  <Field label="Signing key" layout="stacked" readOnly message={{ kind: 'info', text: 'Not supported in this version.' }}>
    <SecretInput presence="unset" changed={false} width="normal" onValueChange={() => undefined} />
  </Field>
);
