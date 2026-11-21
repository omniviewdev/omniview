import { Field, SecretInput } from '@omniviewdev/kit';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './SecretInput.examples.module.css';

// A secret written the way a consumer writes it: the model says whether one is set and whether the user has typed (or cleared) one; the text
// itself goes into the model through `onValueChange` and nowhere else, so these examples keep a boolean and never the text.

/** Opens the field of Replace, the way a user does, for the example that shows the open field; nothing is typed and the focus is left where it was. */
function Opened({ children }: { readonly children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const replace = box.current?.querySelector('button');
    if (replace?.textContent === 'Replace') {
      replace.click();
      box.current?.querySelector('input')?.blur();
    }
  }, []);

  return (
    <div ref={box} className={styles.place}>
      {children}
    </div>
  );
}

/** Nothing is saved: an empty password field that says "Not set". Show is for what is typed, and it says it cannot yet. */
export const NotSet = () => {
  const [changed, setChanged] = useState(false);
  return (
    <Field label="Auth value" layout="stacked" lane>
      <SecretInput
        presence="unset"
        changed={changed}
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

/** A secret is saved and the page never shows it: an empty read-only field that says "Set", and Replace. There is no way to show it, and no button for one. */
export const Set = () => (
  <Field label="API token" layout="stacked" lane>
    <SecretInput presence="set" changed={false} onValueChange={() => undefined} />
  </Field>
);

/** Replace opened an empty field for the new value. Show is for what is typed, and Cancel puts the saved secret back in charge. Escape cancels too. */
export const Replacing = () => {
  const [changed, setChanged] = useState(false);
  return (
    <Field label="API token" layout="stacked" lane>
      <Opened>
        <SecretInput
          presence="set"
          changed={changed}
          onValueChange={(text) => {
            setChanged(text !== '');
          }}
          onRevert={() => {
            setChanged(false);
          }}
        />
      </Opened>
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
    <SecretInput presence="set" changed onValueChange={() => undefined} />
  </Field>
);

/** A secret the host refused: the typed one is kept (in memory, never on the page), the field is marked invalid, and the lane says why. */
export const Invalid = () => (
  <Field label="API token" layout="stacked" message={{ kind: 'error', text: 'Too short. Use 8 or more characters.' }}>
    <SecretInput presence="unset" changed onValueChange={() => undefined} />
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
      <SecretInput presence="set" changed onValueChange={() => undefined} />
    </Field>
  );
};

/** A secret that cannot be replaced says why, in its lane and as its description; the field and Replace stay focusable and do nothing. */
export const DisabledWithReason = () => (
  <Field label="API token" layout="stacked" disabledReason="Start the plugin to change this.">
    <SecretInput presence="set" changed={false} onValueChange={() => undefined} />
  </Field>
);

/** A secret of a kind this version does not know: read-only, with nothing to replace it with. */
export const ReadOnlyNotSupported = () => (
  <Field label="Signing key" layout="stacked" readOnly message={{ kind: 'info', text: 'Not supported in this version.' }}>
    <SecretInput presence="unset" changed={false} onValueChange={() => undefined} />
  </Field>
);
