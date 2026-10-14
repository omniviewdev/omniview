import React from 'react';
import { Input, Text, type ComponentSize, type ComponentVariant } from '@omniviewdev/base-ui';

export type TextInputProps = {
  value?: string;
  onChange?: (value: string) => void;
  size?: ComponentSize;
  variant?: ComponentVariant;
  label?: string;
  helperText?: string;
  error?: boolean | string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  type?: string;
  mono?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  name?: string;
  id?: string;
  startDecorator?: React.ReactNode;
  endDecorator?: React.ReactNode;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  /** Pass-through input attributes (e.g. min, max, step). */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  /** Style applied to the outer wrapper (width, flex, margins). */
  style?: React.CSSProperties;
  className?: string;
};

const wrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
};

/**
 * Small controlled text input with the value-only onChange signature used across the
 * plugin's forms. Built on base-ui Input.
 */
export const TextInput: React.FC<TextInputProps> = ({
  value = '',
  onChange,
  size = 'sm',
  variant = 'outline',
  label,
  helperText,
  error,
  placeholder,
  disabled,
  readOnly,
  type,
  mono,
  autoFocus,
  autoComplete,
  name,
  id,
  startDecorator,
  endDecorator,
  onKeyDown,
  onBlur,
  inputProps,
  style,
  className,
}) => {
  const errorText = typeof error === 'string' ? error : undefined;
  return (
    <div style={{ ...wrapperStyle, ...style }} className={className}>
      {label && (
        <Text as="label" size="xs" tone="muted" htmlFor={id}>
          {label}
        </Text>
      )}
      <Input.Control
        {...inputProps}
        id={id}
        name={name}
        type={type}
        size={size}
        variant={variant}
        color={error ? 'danger' : 'neutral'}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        mono={mono}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        startDecorator={startDecorator}
        endDecorator={endDecorator}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value)}
      />
      {(errorText || helperText) && (
        <Text size="xs" tone={errorText ? 'danger' : 'muted'}>
          {errorText ?? helperText}
        </Text>
      )}
    </div>
  );
};

export default TextInput;
