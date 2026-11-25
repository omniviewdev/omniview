import { Button, Field, Stack, SwatchPicker, type DataColor, type SwatchOption } from '@omniviewdev/kit';
import { useState } from 'react';

// The names are the caller's: a swatch is named "Blue", never by its hex value.
const COLORS: readonly SwatchOption[] = [
  { color: 'blue', label: 'Blue' },
  { color: 'green', label: 'Green' },
  { color: 'amber', label: 'Amber' },
  { color: 'red', label: 'Red' },
  { color: 'purple', label: 'Purple' },
  { color: 'cyan', label: 'Cyan' },
  { color: 'gray', label: 'Gray' },
];

const WITH_RESERVED: readonly SwatchOption[] = COLORS.map((option) =>
  option.color === 'red' ? { ...option, disabledReason: 'Red is reserved for failures.' } : option,
);

// A picker written the way a consumer writes it: the caller owns the colour.
function Picked({ initial, options = COLORS }: { readonly initial: DataColor | null; readonly options?: readonly SwatchOption[] }) {
  const [value, setValue] = useState<DataColor | null>(initial);
  return <SwatchPicker label="Color" options={options} value={value} onValueChange={setValue} />;
}

/** No colour chosen: the default colour. Nothing is checked, and the first swatch is the Tab stop. */
export const NoneChecked = () => <Picked initial={null} />;

/** The chosen swatch has a ring and a check mark, so the choice is never the colour alone. It is the Tab stop. The arrows move the focus, Enter or Space chooses. */
export const OneChecked = () => <Picked initial="purple" />;

/** A colour that cannot be chosen keeps its place and says why in its tooltip and its description. The arrows still reach it. */
export const OneDisabled = () => <Picked initial="blue" options={WITH_RESERVED} />;

/** In a field the field names the group and its lane says which colour is in force. The command that goes back to the default colour is the caller's, after the field. */
export const InField = () => {
  const [value, setValue] = useState<DataColor | null>('purple');
  const current = COLORS.find((option) => option.color === value);
  return (
    <Stack gap={8} align="start">
      <Field label="Color" message={{ kind: 'hint', text: current === undefined ? 'Default color' : `Current: ${current.label}` }}>
        <SwatchPicker options={COLORS} value={value} onValueChange={setValue} />
      </Field>
      {value === null ? null : (
        <Button
          icon="rotate-ccw"
          size="compact"
          onClick={() => {
            setValue(null);
          }}
        >
          Use default color
        </Button>
      )}
    </Stack>
  );
};

/** A field that cannot change says why in its lane, and every swatch is unavailable for that reason. */
export const LockedByField = () => (
  <Field label="Color" disabledReason="Resolve the current operation first.">
    <Picked initial="blue" />
  </Field>
);
