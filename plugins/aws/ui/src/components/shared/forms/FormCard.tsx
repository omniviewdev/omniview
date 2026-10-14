import React from 'react';
import { Button, Chip, Stack, Switch, Text } from '@omniviewdev/base-ui';
import SectionCard from '../ui/SectionCard';
import LabeledRow, { ValueText } from '../ui/LabeledRow';
import TextInput from '../ui/TextInput';
import SelectInput from '../ui/SelectInput';
import TextAreaInput from '../ui/TextAreaInput';
import { chipStyle, toColor } from '../ui/colors';

// ── Field Types ───────────────────────────────────────────────────────────────

type BaseField = {
  key: string;
  label: string;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
};

type TextFieldType = BaseField & {
  type: 'text';
  value: string;
  placeholder?: string;
};

type NumberField = BaseField & {
  type: 'number';
  value: number | '';
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
};

type SelectField = BaseField & {
  type: 'select';
  value: string;
  options: Array<{ label: string; value: string }>;
};

type SwitchField = BaseField & {
  type: 'switch';
  value: boolean;
};

type TextareaField = BaseField & {
  type: 'textarea';
  value: string;
  placeholder?: string;
  minRows?: number;
};

type ReadonlyField = BaseField & {
  type: 'readonly';
  value: string | number | boolean | undefined;
  color?: 'success' | 'danger' | 'warning' | 'neutral';
};

export type FormField =
  | TextFieldType
  | NumberField
  | SelectField
  | SwitchField
  | TextareaField
  | ReadonlyField;

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  title: string;
  icon?: React.ReactNode;
  fields: FormField[];
  onChange: (key: string, value: any) => void;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  compact?: boolean;
};

// ── Field Renderer ────────────────────────────────────────────────────────────

const FieldRenderer: React.FC<{
  field: FormField;
  onChange: (key: string, value: any) => void;
  compact?: boolean;
}> = ({ field, onChange, compact }) => {
  if (field.type === 'readonly') {
    const rendered = typeof field.value === 'boolean'
      ? <Chip size='sm' color={field.value ? 'success' : 'neutral'} variant='solid' style={chipStyle}>{field.value ? 'Yes' : 'No'}</Chip>
      : field.color
        ? <Chip size='sm' color={toColor(field.color)} variant='solid' style={chipStyle}>{String(field.value ?? '')}</Chip>
        : <ValueText>{String(field.value ?? '')}</ValueText>;

    return (
      <LabeledRow label={field.label}>
        {rendered}
      </LabeledRow>
    );
  }

  if (compact) {
    return (
      <LabeledRow label={field.label} alignCenter>
        <CompactFieldInput field={field} onChange={onChange} />
      </LabeledRow>
    );
  }

  return (
    <div>
      <Text size="sm" as="div" style={{ marginBottom: 4 }}>{field.label}</Text>
      <FullFieldInput field={field} onChange={onChange} />
    </div>
  );
};

const CompactFieldInput: React.FC<{
  field: Exclude<FormField, ReadonlyField>;
  onChange: (key: string, value: any) => void;
}> = ({ field, onChange }) => {
  switch (field.type) {
    case 'text':
      return (
        <TextInput
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={(value) => onChange(field.key, value)}
        />
      );
    case 'number':
      return (
        <TextInput
          size='sm'
          type='number'
          value={String(field.value)}
          disabled={field.disabled}
          inputProps={{ min: field.min, max: field.max, step: field.step }}
          onChange={(value) => onChange(field.key, value === '' ? '' : Number(value))}
          style={{ maxWidth: 120 }}
        />
      );
    case 'select':
      return (
        <SelectInput
          size='sm'
          value={field.value}
          disabled={field.disabled}
          onChange={(value) => onChange(field.key, value)}
          options={field.options}
        />
      );
    case 'switch':
      return (
        <Switch
          size='sm'
          checked={field.value}
          disabled={field.disabled}
          onCheckedChange={(checked) => onChange(field.key, checked)}
        />
      );
    case 'textarea':
      return (
        <TextAreaInput
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          minRows={field.minRows || 2}
          onChange={(value) => onChange(field.key, value)}
        />
      );
  }
};

const FullFieldInput: React.FC<{
  field: Exclude<FormField, ReadonlyField>;
  onChange: (key: string, value: any) => void;
}> = ({ field, onChange }) => {
  switch (field.type) {
    case 'text':
      return (
        <TextInput
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={(value) => onChange(field.key, value)}
        />
      );
    case 'number':
      return (
        <TextInput
          size='sm'
          type='number'
          value={String(field.value)}
          disabled={field.disabled}
          inputProps={{ min: field.min, max: field.max, step: field.step }}
          onChange={(value) => onChange(field.key, value === '' ? '' : Number(value))}
        />
      );
    case 'select':
      return (
        <SelectInput
          size='sm'
          value={field.value}
          disabled={field.disabled}
          onChange={(value) => onChange(field.key, value)}
          options={field.options}
        />
      );
    case 'switch':
      return (
        <Switch
          size='sm'
          checked={field.value}
          disabled={field.disabled}
          onCheckedChange={(checked) => onChange(field.key, checked)}
        />
      );
    case 'textarea':
      return (
        <TextAreaInput
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          minRows={field.minRows || 3}
          onChange={(value) => onChange(field.key, value)}
        />
      );
  }
};

// ── Main Component ────────────────────────────────────────────────────────────

const FormCard: React.FC<Props> = ({
  title,
  icon,
  fields,
  onChange,
  onSave,
  onReset,
  dirty,
  saving,
  compact,
}) => {
  return (
    <SectionCard
      title={title}
      icon={icon}
      actions={(onSave || onReset) ? (
        <>
          {onReset && (
            <Button size='sm' variant='ghost' color='neutral' disabled={!dirty || saving} onClick={onReset}>
              Reset
            </Button>
          )}
          {onSave && (
            <Button size='sm' variant='soft' color='brand' disabled={!dirty || saving} onClick={onSave}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </>
      ) : undefined}
      bodyPadding={compact ? '8px 12px' : 12}
    >
      <Stack spacing={compact ? 1 : 3}>
        {fields.map((field) => (
          <FieldRenderer key={field.key} field={field} onChange={onChange} compact={compact} />
        ))}
      </Stack>
    </SectionCard>
  );
};

export default FormCard;
