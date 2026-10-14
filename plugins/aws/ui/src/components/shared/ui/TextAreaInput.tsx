import React from 'react';
import { TextArea, type ComponentSize } from '@omniviewdev/base-ui';

export type TextAreaInputProps = {
  value: string;
  onChange: (value: string) => void;
  size?: ComponentSize;
  placeholder?: string;
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
  mono?: boolean;
  style?: React.CSSProperties;
};

/** Controlled textarea with a value-only onChange, built on base-ui TextArea. */
export const TextAreaInput: React.FC<TextAreaInputProps> = ({
  value,
  onChange,
  size = 'sm',
  placeholder,
  disabled,
  minRows = 2,
  maxRows,
  mono,
  style,
}) => (
  <TextArea.Control
    size={size}
    variant="outline"
    color="neutral"
    rows={minRows}
    mono={mono}
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    style={{
      width: '100%',
      boxSizing: 'border-box',
      ...(maxRows ? { maxHeight: `${maxRows * 1.6}em` } : {}),
      ...style,
    }}
  />
);

export default TextAreaInput;
