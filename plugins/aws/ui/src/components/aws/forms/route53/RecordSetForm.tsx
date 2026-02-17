import React, { useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  Option,
  Select,
  Stack,
  Typography,
} from '@mui/joy';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import FormSection from '../../../shared/forms/FormSection';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data?: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
  /** If true, this is a new record being created (name/type are editable) */
  isNew?: boolean;
};

const RECORD_TYPES = [
  { label: 'A', value: 'A' },
  { label: 'AAAA', value: 'AAAA' },
  { label: 'CNAME', value: 'CNAME' },
  { label: 'MX', value: 'MX' },
  { label: 'NS', value: 'NS' },
  { label: 'TXT', value: 'TXT' },
  { label: 'SRV', value: 'SRV' },
  { label: 'SOA', value: 'SOA' },
  { label: 'CAA', value: 'CAA' },
  { label: 'PTR', value: 'PTR' },
  { label: 'SPF', value: 'SPF' },
];

const RecordSetForm: React.FC<Props> = ({ data, onSave, saving, isNew }) => {
  const existingValues = (data?.ResourceRecords || []).map((r: any) => r.Value || '');

  const { values, setField, dirty, reset } = useFormState({
    Name: data?.Name ?? '',
    Type: data?.Type ?? 'A',
    TTL: data?.TTL ?? 300,
    UseAlias: !!data?.AliasTarget,
    AliasTargetDNS: data?.AliasTarget?.DNSName ?? '',
    AliasTargetZoneId: data?.AliasTarget?.HostedZoneId ?? '',
    AliasEvaluateHealth: data?.AliasTarget?.EvaluateTargetHealth ?? false,
  });

  const [records, setRecords] = useState<string[]>(existingValues);
  const [newValue, setNewValue] = useState('');

  const recordsDirty = JSON.stringify(records) !== JSON.stringify(existingValues);
  const allDirty = dirty || recordsDirty;

  const handleAddValue = () => {
    const val = newValue.trim();
    if (!val) return;
    setRecords([...records, val]);
    setNewValue('');
  };

  const handleRemoveValue = (index: number) => {
    setRecords(records.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (values.UseAlias) {
      onSave({
        Name: values.Name,
        Type: values.Type,
        AliasTarget: {
          DNSName: values.AliasTargetDNS,
          HostedZoneId: values.AliasTargetZoneId,
          EvaluateTargetHealth: values.AliasEvaluateHealth,
        },
      });
    } else {
      onSave({
        Name: values.Name,
        Type: values.Type,
        TTL: values.TTL,
        ResourceRecords: records.map((v) => ({ Value: v })),
      });
    }
  };

  const handleReset = () => {
    reset();
    setRecords(existingValues);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddValue();
    }
  };

  return (
    <FormSection
      title={isNew ? 'Create Record' : 'Edit Record'}
      onSave={handleSave}
      onReset={handleReset}
      dirty={allDirty}
      saving={saving}
    >
      <Stack spacing={1.5}>
        {/* Record Name & Type */}
        <Stack direction='row' spacing={1}>
          <FormControl size='sm' sx={{ flex: 2 }} required>
            <FormLabel>Record Name</FormLabel>
            <Input
              size='sm'
              value={values.Name}
              disabled={!isNew}
              placeholder='subdomain.example.com.'
              onChange={(e) => setField('Name', e.target.value)}
            />
          </FormControl>
          <FormControl size='sm' sx={{ flex: 1 }} required>
            <FormLabel>Type</FormLabel>
            <Select
              size='sm'
              value={values.Type}
              disabled={!isNew}
              onChange={(_, v) => setField('Type', v || 'A')}
            >
              {RECORD_TYPES.map((opt) => (
                <Option key={opt.value} value={opt.value}>{opt.label}</Option>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {/* Alias toggle */}
        <FormControl size='sm'>
          <Stack direction='row' spacing={1} alignItems='center'>
            <FormLabel sx={{ mb: 0 }}>Alias Record</FormLabel>
            <Button
              size='sm'
              variant={values.UseAlias ? 'soft' : 'outlined'}
              color={values.UseAlias ? 'primary' : 'neutral'}
              onClick={() => setField('UseAlias', !values.UseAlias)}
            >
              {values.UseAlias ? 'Yes' : 'No'}
            </Button>
          </Stack>
        </FormControl>

        {values.UseAlias ? (
          /* Alias configuration */
          <Stack spacing={1}>
            <FormControl size='sm' required>
              <FormLabel>Alias Target DNS Name</FormLabel>
              <Input
                size='sm'
                value={values.AliasTargetDNS}
                placeholder='d111111abcdef8.cloudfront.net.'
                onChange={(e) => setField('AliasTargetDNS', e.target.value)}
              />
            </FormControl>
            <FormControl size='sm'>
              <FormLabel>Hosted Zone ID</FormLabel>
              <Input
                size='sm'
                value={values.AliasTargetZoneId}
                placeholder='Z2FDTNDATAQYW2'
                onChange={(e) => setField('AliasTargetZoneId', e.target.value)}
              />
            </FormControl>
          </Stack>
        ) : (
          /* Standard record values */
          <Stack spacing={1}>
            <FormControl size='sm'>
              <FormLabel>TTL (seconds)</FormLabel>
              <Input
                size='sm'
                type='number'
                value={values.TTL}
                slotProps={{ input: { min: 0, max: 2147483647 } }}
                onChange={(e) => setField('TTL', Number(e.target.value))}
                sx={{ maxWidth: 150 }}
              />
            </FormControl>

            {/* Values list */}
            <Box>
              <Typography level='body-sm' fontWeight={600} sx={{ mb: 0.5 }}>Values</Typography>
              <Stack spacing={0.25}>
                {records.map((val, i) => (
                  <Stack key={i} direction='row' spacing={0.5} alignItems='center'>
                    <Typography level='body-xs' fontFamily='monospace' sx={{ flex: 1 }}>{val}</Typography>
                    <IconButton size='sm' variant='plain' color='danger' onClick={() => handleRemoveValue(i)}>
                      <LuTrash2 size={14} />
                    </IconButton>
                  </Stack>
                ))}
                {records.length === 0 && (
                  <Typography level='body-xs' color='neutral'>No values</Typography>
                )}
              </Stack>
              <Stack direction='row' spacing={0.5} sx={{ mt: 0.5 }}>
                <Input
                  size='sm'
                  variant='soft'
                  placeholder={values.Type === 'A' ? '192.0.2.1' : values.Type === 'CNAME' ? 'target.example.com.' : 'value'}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  sx={{ flex: 1, fontSize: 12 }}
                />
                <IconButton size='sm' variant='soft' color='primary' disabled={!newValue.trim()} onClick={handleAddValue}>
                  <LuPlus size={14} />
                </IconButton>
              </Stack>
            </Box>
          </Stack>
        )}
      </Stack>
    </FormSection>
  );
};

export default RecordSetForm;
