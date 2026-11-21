import { Field, NumberInput } from '@omniviewdev/kit';
import { useState } from 'react';

// A number written the way a consumer writes it: the caller owns the text, the draft and the applied value, which is what the form model does.
// The text stays as it was typed (the field never corrects it); a step by a key or a button applies at once, and Enter applies a typed number.

/** The mock's font size: 8 to 32, with its unit. The arrows and Page Up and Page Down step it, the two buttons are shortcuts for the pointer, and the field is the one tab stop. */
export const Idle = () => {
  const [value, setValue] = useState('11');
  return (
    <Field label="Font size" layout="stacked" message={{ kind: 'hint', text: '8 to 32 px' }}>
      <NumberInput value={value} min={8} max={32} unit="px" onValueChange={setValue} />
    </Field>
  );
};

/** A typed number that is not applied: Enter applies it and Escape puts the applied number back. */
export const Dirty = () => {
  const [applied, setApplied] = useState('11');
  const [draft, setDraft] = useState('14');
  return (
    <Field label="Font size" layout="stacked" lane>
      <NumberInput
        value={draft}
        min={8}
        max={32}
        unit="px"
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

/** A check the host is making of the committed number. */
export const Validating = () => {
  const [value, setValue] = useState('6060');
  return (
    <Field label="Profiling port" layout="stacked" message={{ kind: 'checking', text: 'Checking the port…' }}>
      <NumberInput value={value} min={1024} max={65535} onValueChange={setValue} />
    </Field>
  );
};

/** A number outside its range stays in the field, as typed, and is never clamped: the lane says what is wrong and the steps do not move it. */
export const Invalid = () => {
  const [value, setValue] = useState('99');
  return (
    <Field label="Font size" layout="stacked" message={{ kind: 'error', text: 'Out of range. Use 8 to 32.' }}>
      <NumberInput value={value} min={8} max={32} unit="px" onValueChange={setValue} />
    </Field>
  );
};

/** A check that could not be made: the number is not applied, and Retry asks again. */
export const CouldNotCheck = () => {
  const [value, setValue] = useState('6060');
  const [asked, setAsked] = useState(false);
  return (
    <Field
      label="Profiling port"
      layout="stacked"
      message={asked ? { kind: 'checking', text: 'Checking the port…' } : { kind: 'retry', text: '', retry: true }}
      onRetry={() => {
        setAsked(true);
      }}
    >
      <NumberInput value={value} min={1024} max={65535} onValueChange={setValue} />
    </Field>
  );
};

/** A field that cannot change: its steps cannot either, and each says so; the reason is in the lane and in the description of the field. */
export const DisabledWithReason = () => (
  <Field label="Font size" layout="stacked" disabledReason="Start the plugin to change this.">
    <NumberInput value="11" min={8} max={32} unit="px" onValueChange={() => undefined} />
  </Field>
);

/** A number of a kind this version does not know: read-only and not dimmed, with no value to show. */
export const ReadOnlyNotSupported = () => (
  <Field label="Retries" layout="stacked" readOnly message={{ kind: 'info', text: 'Not supported in this version.' }}>
    <NumberInput value="" onValueChange={() => undefined} />
  </Field>
);

/** The unit after the number, muted, and read with it ("12 digits"). */
export const WithUnit = () => {
  const [value, setValue] = useState('5');
  return (
    <Field label="Line number width" layout="stacked" lane>
      <NumberInput value={value} min={1} max={10} unit="digits" onValueChange={setValue} />
    </Field>
  );
};

/** Decimals in steps of a tenth: the sum is exact (1.1 and 0.1 make 1.2), and the unit is a sign. */
export const Decimals = () => {
  const [value, setValue] = useState('1.4');
  return (
    <Field label="Line height" layout="stacked" message={{ kind: 'hint', text: '1 to 3, in steps of 0.1' }}>
      <NumberInput value={value} min={1} max={3} step={0.1} unit="×" onValueChange={setValue} />
    </Field>
  );
};

/** At the bound the step that would pass it is unavailable, and says why ("Minimum is 8"); it stays in the tree and does nothing. */
export const AtTheMinimum = () => {
  const [value, setValue] = useState('8');
  return (
    <Field label="Font size" layout="stacked" lane>
      <NumberInput value={value} min={8} max={32} unit="px" onValueChange={setValue} />
    </Field>
  );
};
