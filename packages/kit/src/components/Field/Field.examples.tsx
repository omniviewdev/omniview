import { Field, Select, TextInput, Toggle } from '@omniviewdev/kit';
import { useState, type ReactNode } from 'react';
import styles from './Field.examples.module.css';

// A control written the way a consumer writes it: the caller owns the draft. These examples are about the field around the control, so the
// control is the plainest: a text field that takes what is typed.
function Draft({ initial = '', placeholder }: { readonly initial?: string; readonly placeholder?: string }) {
  const [value, setValue] = useState(initial);
  return <TextInput value={value} placeholder={placeholder} onValueChange={setValue} />;
}

/** The label in a track of its own beside the control (96 to 140 px), 6 px apart, the two centred: the way a record of several fields is read. The lane under the control is reserved and empty. */
export const Aligned = () => (
  <Field label="Name" lane>
    <Draft initial="orders-api" />
  </Field>
);

/** The label above the control, for a long label or a narrow place. */
export const Stacked = () => (
  <Field label="Name" layout="stacked" lane>
    <Draft initial="orders-api" />
  </Field>
);

/** A required field: an asterisk after the label in the error role that assistive technology does not read, and `required` on the control. */
export const Required = () => (
  <Field label="Name" layout="stacked" required>
    <Draft />
  </Field>
);

/** A short muted word after the label: that the field may stay empty, a unit, a range. */
export const WithAside = () => (
  <Field label="Prefix" layout="stacked" aside="optional">
    <Draft placeholder="archive-" />
  </Field>
);

/** A muted line under the control that says what the field is for. It describes the control, so it is read with it. */
export const WithHelp = () => (
  <Field label="API URL" layout="stacked" help="The address of the API, with its scheme.">
    <Draft initial="https://api.example.test" />
  </Field>
);

/** The line a field says when it has nothing else to say: muted, no glyph. The lane is 16 px high whether it says something or not, so what comes and goes in it moves nothing. */
export const LaneHint = () => (
  <Field label="Name" layout="stacked" message={{ kind: 'hint', text: 'Letters and digits.' }}>
    <Draft initial="orders" />
  </Field>
);

/** An error: its glyph, its word for assistive technology and the error colour. The control is marked invalid and keeps its text. */
export const LaneError = () => (
  <Field label="Name" layout="stacked" message={{ kind: 'error', text: 'Name is taken. Choose another.' }}>
    <Draft initial="orders" />
  </Field>
);

/** A warning never blocks: the control is painted for it and is not marked invalid. */
export const LaneWarning = () => (
  <Field label="Name" layout="stacked" message={{ kind: 'warning', text: 'Name is unusual. Check it.' }}>
    <Draft initial="Orders_2" />
  </Field>
);

/** A check that is running: muted words, and the loader only after a second, so a quick check does not flash one. */
export const LaneChecking = () => (
  <Field label="API URL" layout="stacked" message={{ kind: 'checking', text: 'Contacting the server…' }}>
    <Draft initial="https://api.example.test" />
  </Field>
);

/** A check that could not be made is not an error: the value is not applied, and Retry asks again. */
export const LaneCouldNotCheck = () => {
  const [asked, setAsked] = useState(false);
  return (
    <Field
      label="API URL"
      layout="stacked"
      message={asked ? { kind: 'saved', text: 'Saved.' } : { kind: 'retry', text: '', retry: true }}
      onRetry={() => {
        setAsked(true);
      }}
    >
      <Draft initial="https://api.example.test" />
    </Field>
  );
};

/** A value that was applied: a muted check for two seconds. */
export const LaneSaved = () => (
  <Field label="Port" layout="stacked" message={{ kind: 'saved', text: '' }}>
    <Draft initial="8080" />
  </Field>
);

/** A standing note: a change that waits for a restart. */
export const LaneInfo = () => (
  <Field label="Port" layout="stacked" message={{ kind: 'info', text: 'Restart required to apply.' }}>
    <Draft initial="8080" />
  </Field>
);

/** A field that cannot change says why, in its lane and as the description of its control, which stays focusable. The label stays legible. */
export const DisabledWithReason = () => (
  <Field label="Traces" layout="stacked" disabledReason="Turn on Send telemetry to change this.">
    <Toggle checked onCheckedChange={() => undefined} />
  </Field>
);

/** A value that is a fact, here one this version cannot edit: read-only and not dimmed, and the lane says so. */
export const ReadOnlyNotSupported = () => (
  <Field label="Schedule" layout="stacked" readOnly message={{ kind: 'info', text: 'Not supported in this version.' }}>
    <TextInput value="every 6 hours" onValueChange={() => undefined} />
  </Field>
);

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <Field label={label} lane>
      {children}
    </Field>
  );
}

/** A form column: the labels in one track and the controls in the other, whatever the control, so the controls start at one edge. */
export const FormColumn = () => {
  const [language, setLanguage] = useState('en');
  const [folding, setFolding] = useState(true);
  return (
    <div className={styles.column}>
      <Row label="Name">
        <Draft initial="orders-api" />
      </Row>
      <Row label="Language">
        <Select
          value={language}
          onValueChange={setLanguage}
          options={[
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Español' },
          ]}
        />
      </Row>
      <Row label="Folding">
        <Toggle checked={folding} onCheckedChange={setFolding} />
      </Row>
    </div>
  );
};
