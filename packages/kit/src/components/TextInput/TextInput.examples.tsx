import { Field, TextInput } from '@omniviewdev/kit';
import { useState } from 'react';

// A field written the way a consumer writes it: the caller owns the draft and the applied value, which is what the form model does. A text
// field commits on Enter or blur; the examples have no model, so a commit is just the applied value taking the draft.

/** Nothing has happened to the field: its hint in the lane, the value as the host has it. Typing makes a draft, and Enter applies it. */
export const Idle = () => {
  const [value, setValue] = useState('https://api.example.test');
  return (
    <Field label="API URL" layout="stacked" message={{ kind: 'hint', text: 'Include the scheme.' }}>
      <TextInput value={value} onValueChange={setValue} />
    </Field>
  );
};

/** A draft that is not applied: Enter applies it and Escape puts the applied value back, and Escape is the field's while there is a draft. */
export const Dirty = () => {
  const [applied, setApplied] = useState('collector.example.test:4318');
  const [draft, setDraft] = useState('collector.example.test:9999');
  return (
    <Field label="Endpoint" layout="stacked" lane>
      <TextInput
        value={draft}
        mono
        dirty={draft !== applied}
        onValueChange={setDraft}
        onCommit={setApplied}
        onRevert={() => {
          setDraft(applied);
        }}
      />
    </Field>
  );
};

/** A check that the host is making of the committed value: "Checking…", and its loader after a second. */
export const Validating = () => {
  const [value, setValue] = useState('https://api.example.test');
  return (
    <Field label="API URL" layout="stacked" message={{ kind: 'checking', text: 'Contacting the server…' }}>
      <TextInput value={value} onValueChange={setValue} />
    </Field>
  );
};

/** A refused value keeps its text, shows why in the lane and is marked invalid; the applied value stays in effect. */
export const Invalid = () => {
  const [value, setValue] = useState('bad name');
  return (
    <Field label="Name" layout="stacked" message={{ kind: 'error', text: 'Name has a space. Use letters and digits.' }}>
      <TextInput value={value} onValueChange={setValue} />
    </Field>
  );
};

/** A check that could not be made is not an error, and the value is not applied: Retry asks again. */
export const CouldNotCheck = () => {
  const [value, setValue] = useState('https://api.example.test');
  const [asked, setAsked] = useState(false);
  return (
    <Field
      label="API URL"
      layout="stacked"
      message={asked ? { kind: 'checking', text: 'Contacting the server…' } : { kind: 'retry', text: '', retry: true }}
      onRetry={() => {
        setAsked(true);
      }}
    >
      <TextInput value={value} onValueChange={setValue} />
    </Field>
  );
};

/** A field that cannot change: it stays focusable and selectable, its text is dimmed, and its reason is in the lane and its description. */
export const DisabledWithReason = () => (
  <Field label="Auth header" layout="stacked" disabledReason="Turn on Send telemetry to change this.">
    <TextInput value="Authorization" mono onValueChange={() => undefined} />
  </Field>
);

/** A field of a kind this version does not know: read-only, not dimmed, and never submitted. */
export const ReadOnlyNotSupported = () => (
  <Field label="Schedule" layout="stacked" readOnly message={{ kind: 'info', text: 'Not supported in this version.' }}>
    <TextInput value="" onValueChange={() => undefined} />
  </Field>
);

/** An identifier, an address, a key: the code face, at the width of a settings row (280 px, never wider than its place). */
export const Mono = () => {
  const [value, setValue] = useState('collector.example.test:4318');
  return (
    <Field label="Endpoint" layout="stacked" lane>
      <TextInput value={value} mono width="normal" onValueChange={setValue} />
    </Field>
  );
};

/** A character that is not allowed is refused as it is typed (a key, a paste, a drop), before the field takes it; here only digits, dots, colons and hyphens. */
export const Filtered = () => {
  const [value, setValue] = useState('127.0.0.1:4318');
  return (
    <Field label="Host and port" layout="stacked" message={{ kind: 'hint', text: 'Digits, dots and colons.' }}>
      <TextInput
        value={value}
        mono
        allows={(text) => /^[0-9.:-]*$/.test(text)}
        onValueChange={setValue}
      />
    </Field>
  );
};
