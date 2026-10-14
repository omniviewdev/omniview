import React from 'react';
import { Select, type ComponentSize } from '@omniviewdev/base-ui';
import { LuChevronDown } from 'react-icons/lu';

export type SelectInputOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectInputProps = {
  options: SelectInputOption[];
  value: string;
  onChange: (value: string) => void;
  size?: ComponentSize;
  placeholder?: string;
  disabled?: boolean;
  /** Style applied to the trigger (width, flex). */
  style?: React.CSSProperties;
};

/** Single-value select driven by an options array, built on base-ui Select. */
export const SelectInput: React.FC<SelectInputProps> = ({
  options,
  value,
  onChange,
  size = 'sm',
  placeholder,
  disabled,
  style,
}) => (
  <Select.Root<string>
    size={size}
    variant="outline"
    color="neutral"
    value={value}
    items={options.map((o) => ({ value: o.value, label: o.label }))}
    disabled={disabled}
    onValueChange={(next) => {
      if (next !== null) onChange(next);
    }}
  >
    <Select.Trigger style={style}>
      <Select.Value placeholder={placeholder} />
      <Select.Icon>
        <LuChevronDown aria-hidden />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner sideOffset={4}>
        <Select.Popup>
          <Select.List>
            {options.map((o) => (
              <Select.Item key={o.value} value={o.value} disabled={o.disabled}>
                <Select.ItemText>{o.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
);

export default SelectInput;
