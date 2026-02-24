import React from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Divider from '@mui/material/Divider';
import Switch from '@mui/material/Switch';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button } from '@omniviewdev/ui/buttons';
import { TextField, TextArea, Select } from '@omniviewdev/ui/inputs';
import { Card, Chip } from '@omniviewdev/ui';

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
    const chipColor = field.color === 'danger' ? 'error' : field.color === 'neutral' ? 'default' : field.color;
    const rendered = typeof field.value === 'boolean'
      ? <Chip size='sm' label={field.value ? 'Yes' : 'No'} color={field.value ? 'success' : 'default'} variant='filled' sx={{ borderRadius: 1 }} />
      : field.color
        ? <Chip size='sm' label={String(field.value ?? '')} color={chipColor} variant='filled' sx={{ borderRadius: 1 }} />
        : <Text size="xs" sx={{ fontWeight: 600, fontSize: 12, wordBreak: 'break-all' }}>{String(field.value ?? '')}</Text>;

    return (
      <Grid container spacing={0}>
        <Grid size={4} sx={{ alignItems: 'center' }}>
          <Text size="xs" sx={{ color: 'neutral.300' }}>{field.label}</Text>
        </Grid>
        <Grid size={8} sx={{ alignItems: 'center' }}>{rendered}</Grid>
      </Grid>
    );
  }

  if (compact) {
    return (
      <Grid container spacing={0} alignItems='center'>
        <Grid size={4}>
          <Text size="xs" sx={{ color: 'neutral.300' }}>{field.label}</Text>
        </Grid>
        <Grid size={8}>
          <CompactFieldInput field={field} onChange={onChange} />
        </Grid>
      </Grid>
    );
  }

  return (
    <Box>
      <Text size="sm" sx={{ mb: 0.5 }}>{field.label}</Text>
      <FullFieldInput field={field} onChange={onChange} />
    </Box>
  );
};

const CompactFieldInput: React.FC<{
  field: Exclude<FormField, ReadonlyField>;
  onChange: (key: string, value: any) => void;
}> = ({ field, onChange }) => {
  switch (field.type) {
    case 'text':
      return (
        <TextField
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={(value) => onChange(field.key, value)}
          sx={{ fontSize: 12 }}
        />
      );
    case 'number':
      return (
        <TextField
          size='sm'
          type='number'
          value={String(field.value)}
          disabled={field.disabled}
          inputProps={{ min: field.min, max: field.max, step: field.step }}
          onChange={(value) => onChange(field.key, value === '' ? '' : Number(value))}
          sx={{ fontSize: 12, maxWidth: 120 }}
        />
      );
    case 'select':
      return (
        <Select
          size='sm'
          value={field.value}
          disabled={field.disabled}
          onChange={(value) => onChange(field.key, value as string)}
          options={field.options}
          sx={{ fontSize: 12 }}
        />
      );
    case 'switch':
      return (
        <Switch
          size='small'
          checked={field.value}
          disabled={field.disabled}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
      );
    case 'textarea':
      return (
        <TextArea
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          minRows={field.minRows || 2}
          onChange={(value) => onChange(field.key, value)}
          sx={{ fontSize: 12 }}
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
        <TextField
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={(value) => onChange(field.key, value)}
        />
      );
    case 'number':
      return (
        <TextField
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
        <Select
          size='sm'
          value={field.value}
          disabled={field.disabled}
          onChange={(value) => onChange(field.key, value as string)}
          options={field.options}
        />
      );
    case 'switch':
      return (
        <Switch
          size='small'
          checked={field.value}
          disabled={field.disabled}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
      );
    case 'textarea':
      return (
        <TextArea
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
    <Card
      sx={{
        '--Card-padding': '0px',
        '--Card-gap': '0px',
        borderRadius: 1,
        gap: '0px',
      }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack direction='row' spacing={1} alignItems='center'>
            {icon}
            <Text weight="semibold" size="sm">{title}</Text>
          </Stack>
          {(onSave || onReset) && (
            <Stack direction='row' spacing={0.5}>
              {onReset && (
                <Button size='sm' emphasis='ghost' color='neutral' disabled={!dirty || saving} onClick={onReset}>
                  Reset
                </Button>
              )}
              {onSave && (
                <Button size='sm' emphasis='soft' color='primary' disabled={!dirty || saving} onClick={onSave}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Box>
      <Divider />
      <Box
        sx={{
          p: compact ? 1 : 1.5,
          px: 1.5,
          backgroundColor: 'background.paper',
          borderBottomRightRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        <Stack spacing={compact ? 0.5 : 1.5}>
          {fields.map((field) => (
            <FieldRenderer key={field.key} field={field} onChange={onChange} compact={compact} />
          ))}
        </Stack>
      </Box>
    </Card>
  );
};

export default FormCard;
