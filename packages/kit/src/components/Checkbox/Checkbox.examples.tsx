import { Checkbox, Field } from '@omniviewdev/kit';
import { useState } from 'react';

// A checkbox written the way a consumer writes it: the caller owns the value.

/** Off: a bare box needs a name from the Field around it. */
export const Off = () => {
  const [on, setOn] = useState(false);
  return (
    <Field label="Match case" layout="stacked">
      <Checkbox checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** On: the accent box and the check. */
export const On = () => {
  const [on, setOn] = useState(true);
  return (
    <Field label="Whole word" layout="stacked">
      <Checkbox checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** Mixed: a dash, for a choice that covers some of a set; a click asks for on. */
export const Mixed = () => {
  const [on, setOn] = useState<boolean | 'mixed'>('mixed');
  return (
    <Field label="Select all" layout="stacked">
      <Checkbox checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** With a text: the text names the box and takes the click. */
export const WithText = () => {
  const [on, setOn] = useState(false);
  return <Checkbox label="Match case" checked={on} onCheckedChange={setOn} />;
};

/** Inside a Field with its label at the start: the Field names the box, and its lane prints a message. */
export const InsideField = () => {
  const [on, setOn] = useState(true);
  return (
    <Field label="Match case" lane>
      <Checkbox checked={on} onCheckedChange={setOn} />
    </Field>
  );
};

/** A box that cannot change says why as its description and its tooltip, and stays focusable. */
export const DisabledWithReason = () => <Checkbox label="Match case" checked disabledReason="The pattern is not text." onCheckedChange={() => undefined} />;
