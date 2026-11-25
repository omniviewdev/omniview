import { Field, ValuePicker, WorkspaceToolbar, type ValuePickerOption } from '@omniviewdev/kit';
import { useState } from 'react';

// A picker written the way a consumer writes it: the caller owns the choice, and every change applies at once. The popup opens with a press, Enter,
// Space or an arrow.

const PLATFORMS: readonly ValuePickerOption[] = [
  { value: 'cloud-a', label: 'Cloud A', description: '3 connections' },
  { value: 'cloud-b', label: 'Cloud B', description: '2 connections' },
  { value: 'cloud-c', label: 'Cloud C', description: '1 connection' },
  { value: 'local', label: 'Local', description: '4 connections' },
];

const MEMBERS: readonly ValuePickerOption[] = [
  { value: 'connection-a', label: 'Connection A', description: 'production · account-1' },
  { value: 'connection-b', label: 'Connection B', description: 'staging · account-1' },
  { value: 'connection-c', label: 'Connection C', description: 'production · account-2' },
  { value: 'connection-d', label: 'Connection D', disabledReason: 'Archived connections cannot be members.' },
];

const COLOURS: readonly ValuePickerOption[] = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
];

const LONG: readonly ValuePickerOption[] = Array.from({ length: 5000 }, (_, index) => ({ value: `item-${index + 1}`, label: `Item ${index + 1}` }));

/** A filter in the lane of a collection: the all row says no narrowing, the trigger says it while nothing else is chosen, and each option says how many it holds. */
export const Facet = () => {
  const [value, setValue] = useState<readonly string[]>([]);
  return (
    <WorkspaceToolbar label="Filter connections">
      <ValuePicker label="Platform" options={PLATFORMS} value={value} onValueChange={setValue} allOption="All platforms" />
    </WorkspaceToolbar>
  );
};

/** Two options are chosen: the trigger counts them, and the list opens on the first. The all row is chosen again by emptying the choice. */
export const FacetWithChoice = () => {
  const [value, setValue] = useState<readonly string[]>(['cloud-b', 'local']);
  return (
    <WorkspaceToolbar label="Filter connections">
      <ValuePicker label="Platform" options={PLATFORMS} value={value} onValueChange={setValue} allOption="All platforms" />
    </WorkspaceToolbar>
  );
};

/** A field of a form: the Field's label names the picker and its lane describes it, and with no all row the trigger says "None selected". An option that cannot be chosen says why in its second line. */
export const FormField = () => {
  const [value, setValue] = useState<readonly string[]>([]);
  return (
    <Field label="Members" layout="stacked" help="Members stay included, even when the rules do not match." lane>
      <ValuePicker label="Folder members" options={MEMBERS} value={value} onValueChange={setValue} />
    </Field>
  );
};

/** A short list needs no search field: the list itself holds the focus. */
export const WithoutSearch = () => {
  const [value, setValue] = useState<readonly string[]>(['green']);
  return (
    <Field label="Colours" layout="stacked">
      <ValuePicker label="Colours" options={COLOURS} value={value} onValueChange={setValue} searchable={false} />
    </Field>
  );
};

/** Five thousand options: a screenful of rows is mounted whatever the length, and Home, End and the search reach the rest. */
export const LongList = () => {
  const [value, setValue] = useState<readonly string[]>(['item-2500']);
  return (
    <Field label="Items" layout="stacked">
      <ValuePicker label="Items" options={LONG} value={value} onValueChange={setValue} />
    </Field>
  );
};

/** A picker that cannot change does not open, keeps its choice, stays focusable, and says why: the lane prints the reason. */
export const Disabled = () => (
  <Field label="Members" layout="stacked" disabledReason="Resolve the current operation first.">
    <ValuePicker label="Folder members" options={MEMBERS} value={['connection-a']} onValueChange={() => undefined} />
  </Field>
);

/** A filter that cannot change on its own says why in its tooltip. */
export const DisabledFacet = () => (
  <WorkspaceToolbar label="Filter connections">
    <ValuePicker label="Platform" options={PLATFORMS} value={[]} onValueChange={() => undefined} allOption="All platforms" disabledReason="There are no connections to filter." />
  </WorkspaceToolbar>
);

/** Open it and type a word that no option has: the list says "No matches", and Enter chooses nothing. */
export const NoMatches = () => {
  const [value, setValue] = useState<readonly string[]>([]);
  return (
    <Field label="Members" layout="stacked">
      <ValuePicker label="Folder members" options={MEMBERS} value={value} onValueChange={setValue} />
    </Field>
  );
};

/** Nothing to choose from: the popup opens with its search field and says "No options available". */
export const NoOptions = () => (
  <Field label="Members" layout="stacked">
    <ValuePicker label="Folder members" options={[]} value={[]} onValueChange={() => undefined} />
  </Field>
);
