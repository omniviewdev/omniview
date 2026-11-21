import { Field, Select, type SelectOption } from '@omniviewdev/kit';
import { useState } from 'react';

// A select written the way a consumer writes it: the caller owns the value, and a choice applies at once (design S125).

const LANGUAGES: readonly SelectOption[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
];

const LEVELS: readonly SelectOption[] = [
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

/** The native select in the face of an input, its arrow drawn by the part in a theme role. The platform's popup and keys do the choosing. */
export const Idle = () => {
  const [value, setValue] = useState('en');
  return (
    <Field label="Language" layout="stacked" lane>
      <Select value={value} options={LANGUAGES} onValueChange={setValue} />
    </Field>
  );
};

/** A choice the host is checking before it keeps it. */
export const Validating = () => {
  const [value, setValue] = useState('debug');
  return (
    <Field label="Default log level" layout="stacked" message={{ kind: 'checking', text: 'Changing the level…' }}>
      <Select value={value} options={LEVELS} onValueChange={setValue} />
    </Field>
  );
};

/** A value that is not one of the options (a saved choice that went away): marked invalid, and the lane says what to do. */
export const Invalid = () => {
  const [value, setValue] = useState('fr');
  return (
    <Field label="Language" layout="stacked" message={{ kind: 'error', text: 'Not a language. Choose one.' }}>
      <Select value={value} options={LANGUAGES} placeholder="Choose a language" onValueChange={setValue} />
    </Field>
  );
};

/** A choice the host could not make: not applied, and Retry asks again. */
export const CouldNotCheck = () => {
  const [value, setValue] = useState('info');
  const [asked, setAsked] = useState(false);
  return (
    <Field
      label="Default log level"
      layout="stacked"
      message={asked ? { kind: 'checking', text: 'Changing the level…' } : { kind: 'retry', text: '', retry: true }}
      onRetry={() => {
        setAsked(true);
      }}
    >
      <Select value={value} options={LEVELS} onValueChange={setValue} />
    </Field>
  );
};

/** A select that cannot change does not open and does not change, keeps its value, stays focusable, and says why. */
export const DisabledWithReason = () => (
  <Field label="Language" layout="stacked" disabledReason="Start the plugin to change this.">
    <Select value="en" options={LANGUAGES} onValueChange={() => undefined} />
  </Field>
);

/** A select of a kind this version does not know: read-only, not dimmed, and it does not open. */
export const ReadOnlyNotSupported = () => (
  <Field label="Region" layout="stacked" readOnly message={{ kind: 'info', text: 'Not supported in this version.' }}>
    <Select value="" options={[]} placeholder="Not set" onValueChange={() => undefined} />
  </Field>
);

/** Nothing is chosen yet: a placeholder that cannot be chosen again. */
export const NothingChosen = () => {
  const [value, setValue] = useState('');
  return (
    <Field label="Language" layout="stacked" lane>
      <Select value={value} options={LANGUAGES} placeholder="Choose a language" onValueChange={setValue} />
    </Field>
  );
};

/** Options that are identifiers take the code face, and the box is at least the mock's 200 px in a settings row. */
export const Mono = () => {
  const [value, setValue] = useState('info');
  return (
    <Field label="Level" layout="stacked" lane>
      <Select value={value} options={LEVELS} mono width="normal" onValueChange={setValue} />
    </Field>
  );
};
