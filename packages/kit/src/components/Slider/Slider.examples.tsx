import { Field, Slider } from '@omniviewdev/kit';
import { useState } from 'react';

/** A percentage with a live readout. Only the final value of a changed gesture becomes the field's value. */
export const Percentage = () => {
  const [opacity, setOpacity] = useState(62);
  return (
    <Field label="Chrome opacity" layout="row">
      <Slider value={opacity} onCommit={setOpacity} unit="%" />
    </Field>
  );
};

/** A fractional range whose minimum is not zero. */
export const Fractional = () => {
  const [speed, setSpeed] = useState(1.25);
  return (
    <Field label="Playback speed" layout="stacked">
      <Slider value={speed} min={0.5} max={2} step={0.25} unit="×" onCommit={setSpeed} />
    </Field>
  );
};

/** The accepted value stays focusable when the surrounding field is read-only. */
export const ReadOnly = () => (
  <Field label="Scale" layout="stacked" readOnly>
    <Slider value={100} unit="%" />
  </Field>
);

/** The Field supplies both its label and the reason it cannot change. */
export const Disabled = () => (
  <Field label="Volume" layout="stacked" disabledReason="Muted">
    <Slider value={0} unit="%" />
  </Field>
);
