import { Field, IconButton, NumberInput, Select, TextInput, Toggle, type SelectOption, type TextInputWidth } from '@omniviewdev/kit';
import { useState, type ReactNode } from 'react';
import styles from './Field.examples.module.css';

// A control written the way a consumer writes it: the caller owns the draft. These examples are about the field around the control, so the
// control is the plainest: a text field that takes what is typed.
function Draft({ initial = '', placeholder, width, mono }: { readonly initial?: string; readonly placeholder?: string; readonly width?: TextInputWidth; readonly mono?: boolean }) {
  const [value, setValue] = useState(initial);
  return <TextInput value={value} placeholder={placeholder} width={width} mono={mono} onValueChange={setValue} />;
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

// ---- the row: a settings row in every state of the field model (design 16 S126, S127) ---------------------------------------------------------
// A row is the title, the description and the message lane on one side, and the control and a trailing slot on the other. The caller owns the value, the
// message and what stands in the slot, as the form model does: each example holds the little state it needs and nothing else. A row that applies a
// value reserves its lane (`lane`), so that no message moves anything: a row is 44 px high without a lane, 60 px with one and a description of a
// line, and 76 px with a description of two lines or more, whatever the lane says.

const NAME = 'How the workspace is named in the title bar.';
const SERVER = 'The address Omniview contacts first.';
const PORT = 'The port Omniview listens on.';
const LANGUAGES: readonly SelectOption[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
];

/** A row at rest: the title, a muted description, the control, and at its end the slot that is held for a command (empty here). It has nothing to say about its value, so it has no lane. */
export const RowDefault = () => (
  <Field layout="row" label="Display name" help={NAME}>
    <Draft initial="orders-api" width="normal" />
  </Field>
);

/** The line a row says when it has nothing else to say: muted, no glyph, in the lane under the description, which is 16 px high whether it says something or not. */
export const RowHint = () => (
  <Field layout="row" label="Display name" help={NAME} message={{ kind: 'hint', text: 'Letters and digits.' }}>
    <Draft initial="orders-api" width="normal" />
  </Field>
);

/** A value that differs from its default: the command that puts it back stands in the trailing slot, which is held whether it shows or not, so that it comes and goes without moving the control. The row decides nothing about it: the caller shows it when the value differs. */
export const RowModified = () => {
  const [value, setValue] = useState('orders-prod');
  return (
    <Field
      layout="row"
      label="Display name"
      help={NAME}
      lane
      trailing={
        value === 'orders-api' ? null : (
          <IconButton
            icon="undo"
            label="Reset Display name to default"
            variant="ghost"
            size="row"
            onClick={() => {
              setValue('orders-api');
            }}
          />
        )
      }
    >
      <TextInput value={value} width="normal" onValueChange={setValue} />
    </Field>
  );
};

/** An error: its glyph hangs in the gutter at the start of the row, so that its words start where the title starts, and the control is marked invalid and keeps its text. */
export const RowInvalid = () => (
  <Field layout="row" label="Display name" help={NAME} message={{ kind: 'error', text: 'Name has a space. Use letters and digits.' }}>
    <Draft initial="orders api" width="normal" />
  </Field>
);

/** A warning never blocks: the control is painted for it and is not invalid. */
export const RowWarning = () => (
  <Field layout="row" label="Log directory" help="Where the logs of this workspace are written." message={{ kind: 'warning', text: 'Directory is not empty. Existing files stay.' }}>
    <Draft initial="logs" width="normal" />
  </Field>
);

/** A check that is running: muted words, and the loader only after a second, so a quick check does not flash one. */
export const RowChecking = () => (
  <Field layout="row" label="Server address" help={SERVER} message={{ kind: 'checking', text: 'Contacting the server…' }}>
    <Draft initial="https://api.example.test" width="normal" />
  </Field>
);

/** A check that could not be made is not an error: the value is not applied, and Retry asks again. */
export const RowCouldNotCheck = () => {
  const [asked, setAsked] = useState(false);
  return (
    <Field
      layout="row"
      label="Server address"
      help={SERVER}
      message={asked ? { kind: 'saved', text: '' } : { kind: 'retry', text: '', retry: true }}
      onRetry={() => {
        setAsked(true);
      }}
    >
      <Draft initial="https://api.example.test" width="normal" />
    </Field>
  );
};

/** A value that was applied: a muted check for two seconds. */
export const RowSaved = () => (
  <Field layout="row" label="Port" help={PORT} message={{ kind: 'saved', text: '' }}>
    <Draft initial="8080" width="normal" />
  </Field>
);

/** A value the host could not apply: an error that offers Retry, with the reason as the tip of the message. The value stays in the field. */
export const RowApplyFailed = () => {
  const [asked, setAsked] = useState(false);
  return (
    <Field
      layout="row"
      label="Port"
      help={PORT}
      message={asked ? { kind: 'saved', text: '' } : { kind: 'error', text: 'Couldn’t save this change. Retry.', detail: 'The settings store is read-only.', retry: true }}
      onRetry={() => {
        setAsked(true);
      }}
    >
      <Draft initial="9000" width="normal" />
    </Field>
  );
};

/** A change that waits for a restart: a standing note with the info glyph, until the restart. */
export const RowRestartRequired = () => (
  <Field layout="row" label="Port" help={PORT} message={{ kind: 'info', text: 'Restart required to apply.' }}>
    <Draft initial="8080" width="normal" />
  </Field>
);

/** A row that cannot change says why, in its lane and as the description of its control, which stays focusable. The title stays legible. */
export const RowUnavailable = () => (
  <Field layout="row" label="Traces" help="Send traces of this workspace to the collector." disabledReason="Turn on Send telemetry to change this.">
    <Toggle checked onCheckedChange={() => undefined} />
  </Field>
);

/** A value that is a fact, here one the organisation manages: read-only and not dimmed, and the lane says who decides. */
export const RowReadOnly = () => (
  <Field layout="row" label="Data directory" help="Where Omniview keeps its data." readOnly message={{ kind: 'info', text: 'Managed by your organisation.' }}>
    <TextInput value="/var/omniview" width="normal" onValueChange={() => undefined} />
  </Field>
);

/** A description of more than two lines ends at the second with an ellipsis, and the whole of it is the tooltip while it is cut: the row is 76 px high with its lane, whatever the description says. */
export const RowLongDescription = () => (
  <Field
    layout="row"
    label="Retention"
    lane
    help="How long Omniview keeps what it records about a workspace before it removes it: the logs of its sessions, the audit trail of what ran and the notices it showed. A longer time keeps more history and more files on disk; a shorter one frees the room sooner and leaves less to look back on when something goes wrong."
  >
    <Draft initial="30 days" width="normal" />
  </Field>
);

/** A switch in the row: the title names it, and a click on the title turns it. It sits at the top of the control column, level with the title. */
export const RowWithToggle = () => {
  const [on, setOn] = useState(true);
  return (
    <Field layout="row" label="Fold code" help="Collapse blocks of code in the editor.">
      <Toggle checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** A text field in the row, in the code face and at the widest of the three widths. */
export const RowWithTextInput = () => (
  <Field layout="row" label="Collector address" help="The host and port that traces are sent to." lane>
    <Draft initial="collector.example.test:4318" width="wide" mono />
  </Field>
);

/** A select in the row: at least 200 px wide, as wide as its longest option needs. */
export const RowWithSelect = () => {
  const [language, setLanguage] = useState('en');
  return (
    <Field layout="row" label="Language" help="The language of the interface.">
      <Select value={language} options={LANGUAGES} width="normal" onValueChange={setLanguage} />
    </Field>
  );
};

/** A number in the row: its field and its two step buttons, which are a pointer's shortcuts and not tab stops. A number can reject a value, so the row reserves its lane. */
export const RowWithNumberInput = () => {
  const [size, setSize] = useState('14');
  return (
    <Field layout="row" label="Font size" help="The size of the text in the editor, in pixels." lane>
      <NumberInput value={size} min={8} max={32} unit="px" onValueChange={setSize} />
    </Field>
  );
};
