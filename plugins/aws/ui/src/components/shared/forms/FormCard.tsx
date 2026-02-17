import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  FormLabel,
  Grid,
  Input,
  Option,
  Select,
  Stack,
  Switch,
  Textarea,
  Typography,
} from '@mui/joy';

// ── Field Types ───────────────────────────────────────────────────────────────

type BaseField = {
  key: string;
  label: string;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
};

type TextField = BaseField & {
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
  | TextField
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
      ? <Chip size='sm' variant='soft' color={field.value ? 'success' : 'neutral'} sx={{ borderRadius: 'sm' }}>{field.value ? 'Yes' : 'No'}</Chip>
      : field.color
        ? <Chip size='sm' variant='soft' color={field.color} sx={{ borderRadius: 'sm' }}>{String(field.value ?? '')}</Chip>
        : <Typography fontWeight={600} fontSize={12} level='body-xs' sx={{ wordBreak: 'break-all' }}>{String(field.value ?? '')}</Typography>;

    return (
      <Grid container spacing={0}>
        <Grid xs={4} alignItems='center'>
          <Typography textColor='neutral.300' level='body-xs'>{field.label}</Typography>
        </Grid>
        <Grid xs={8} alignItems='center'>{rendered}</Grid>
      </Grid>
    );
  }

  if (compact) {
    return (
      <Grid container spacing={0} alignItems='center'>
        <Grid xs={4}>
          <Typography textColor='neutral.300' level='body-xs'>{field.label}</Typography>
        </Grid>
        <Grid xs={8}>
          <CompactFieldInput field={field} onChange={onChange} />
        </Grid>
      </Grid>
    );
  }

  return (
    <FormControl size='sm' required={field.required}>
      <FormLabel>{field.label}</FormLabel>
      <FullFieldInput field={field} onChange={onChange} />
    </FormControl>
  );
};

const CompactFieldInput: React.FC<{
  field: Exclude<FormField, ReadonlyField>;
  onChange: (key: string, value: any) => void;
}> = ({ field, onChange }) => {
  switch (field.type) {
    case 'text':
      return (
        <Input
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
          sx={{ fontSize: 12 }}
        />
      );
    case 'number':
      return (
        <Input
          size='sm'
          type='number'
          value={field.value}
          disabled={field.disabled}
          slotProps={{ input: { min: field.min, max: field.max, step: field.step } }}
          onChange={(e) => onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))}
          sx={{ fontSize: 12, maxWidth: 120 }}
        />
      );
    case 'select':
      return (
        <Select
          size='sm'
          value={field.value}
          disabled={field.disabled}
          onChange={(_, val) => onChange(field.key, val)}
          sx={{ fontSize: 12 }}
        >
          {field.options.map((opt) => (
            <Option key={opt.value} value={opt.value}>{opt.label}</Option>
          ))}
        </Select>
      );
    case 'switch':
      return (
        <Switch
          size='sm'
          checked={field.value}
          disabled={field.disabled}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
      );
    case 'textarea':
      return (
        <Textarea
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          minRows={field.minRows || 2}
          onChange={(e) => onChange(field.key, e.target.value)}
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
        <Input
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
    case 'number':
      return (
        <Input
          size='sm'
          type='number'
          value={field.value}
          disabled={field.disabled}
          slotProps={{ input: { min: field.min, max: field.max, step: field.step } }}
          onChange={(e) => onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'select':
      return (
        <Select
          size='sm'
          value={field.value}
          disabled={field.disabled}
          onChange={(_, val) => onChange(field.key, val)}
        >
          {field.options.map((opt) => (
            <Option key={opt.value} value={opt.value}>{opt.label}</Option>
          ))}
        </Select>
      );
    case 'switch':
      return (
        <Switch
          size='sm'
          checked={field.value}
          disabled={field.disabled}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
      );
    case 'textarea':
      return (
        <Textarea
          size='sm'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          minRows={field.minRows || 3}
          onChange={(e) => onChange(field.key, e.target.value)}
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
        borderRadius: 'sm',
        gap: '0px',
      }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack direction='row' spacing={1} alignItems='center'>
            {icon}
            <Typography level='title-sm'>{title}</Typography>
          </Stack>
          {(onSave || onReset) && (
            <Stack direction='row' spacing={0.5}>
              {onReset && (
                <Button size='sm' variant='plain' color='neutral' disabled={!dirty || saving} onClick={onReset}>
                  Reset
                </Button>
              )}
              {onSave && (
                <Button size='sm' variant='soft' color='primary' disabled={!dirty || saving} loading={saving} onClick={onSave}>
                  Save
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Box>
      <Divider />
      <CardContent
        sx={{
          p: compact ? 1 : 1.5,
          px: 1.5,
          backgroundColor: 'background.level1',
          borderBottomRightRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        <Stack spacing={compact ? 0.5 : 1.5}>
          {fields.map((field) => (
            <FieldRenderer key={field.key} field={field} onChange={onChange} compact={compact} />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default FormCard;
