import { Field, Toggle } from '@omniviewdev/kit';
import { useState } from 'react';

// A switch written the way a consumer writes it: the caller owns the value, and a change applies at once (a setting has no Save), so there is
// no draft to put back: a switch has no "dirty" state of its own.

/** Off. The label names it and a click on the label turns it; the name stays the same when it is on. */
export const Idle = () => {
  const [on, setOn] = useState(false);
  return (
    <Field label="Format on type" layout="stacked" lane>
      <Toggle checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** On: the accent track and the knob at its end, moved by a transform and not by layout. */
export const On = () => {
  const [on, setOn] = useState(true);
  return (
    <Field label="Folding" layout="stacked" lane>
      <Toggle checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** A change the host is checking before it keeps it: "Checking…" in the lane, and its loader after a second. */
export const Validating = () => {
  const [on, setOn] = useState(true);
  return (
    <Field label="Local profiling" layout="stacked" message={{ kind: 'checking', text: 'Starting the profiler…' }}>
      <Toggle checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** A change the host could not make: the lane says so and offers Retry; nothing is applied, and the switch is not an error. */
export const CouldNotCheck = () => {
  const [on, setOn] = useState(true);
  const [asked, setAsked] = useState(false);
  return (
    <Field
      label="Local profiling"
      layout="stacked"
      message={asked ? { kind: 'checking', text: 'Starting the profiler…' } : { kind: 'retry', text: '', retry: true }}
      onRetry={() => {
        setAsked(true);
      }}
    >
      <Toggle checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** A switch that cannot change says why, in its lane and as its description, and stays focusable: the track and the knob take the disabled roles. */
export const DisabledWithReason = () => (
  <Field label="Traces" layout="stacked" disabledReason="Turn on Send telemetry to change this.">
    <Toggle checked onCheckedChange={() => undefined} />
  </Field>
);

/** A switch of a kind this version does not know: read-only (announced as such), as legible as an enabled one, and it changes nothing. */
export const ReadOnlyNotSupported = () => (
  <Field label="Mirror" layout="stacked" readOnly message={{ kind: 'info', text: 'Not supported in this version.' }}>
    <Toggle checked={false} onCheckedChange={() => undefined} />
  </Field>
);
