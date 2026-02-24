import React, { useState } from 'react';
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { TextField, Select } from '@omniviewdev/ui/inputs';
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
          <Box sx={{ flex: 2 }}>
            <Text size="xs" sx={{ mb: 0.5 }}>Record Name</Text>
            <TextField
              size='sm'
              value={values.Name}
              disabled={!isNew}
              placeholder='subdomain.example.com.'
              onChange={(value) => setField('Name', value)}
            />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Text size="xs" sx={{ mb: 0.5 }}>Type</Text>
            <Select
              size='sm'
              value={values.Type}
              disabled={!isNew}
              onChange={(value) => setField('Type', (value as string) || 'A')}
              options={RECORD_TYPES}
            />
          </Box>
        </Stack>

        {/* Alias toggle */}
        <Stack direction='row' spacing={1} alignItems='center'>
          <Text size="xs">Alias Record</Text>
          <Button
            size='sm'
            emphasis={values.UseAlias ? 'soft' : 'outline'}
            color={values.UseAlias ? 'primary' : 'neutral'}
            onClick={() => setField('UseAlias', !values.UseAlias)}
          >
            {values.UseAlias ? 'Yes' : 'No'}
          </Button>
        </Stack>

        {values.UseAlias ? (
          /* Alias configuration */
          <Stack spacing={1}>
            <Box>
              <Text size="xs" sx={{ mb: 0.5 }}>Alias Target DNS Name</Text>
              <TextField
                size='sm'
                value={values.AliasTargetDNS}
                placeholder='d111111abcdef8.cloudfront.net.'
                onChange={(value) => setField('AliasTargetDNS', value)}
              />
            </Box>
            <Box>
              <Text size="xs" sx={{ mb: 0.5 }}>Hosted Zone ID</Text>
              <TextField
                size='sm'
                value={values.AliasTargetZoneId}
                placeholder='Z2FDTNDATAQYW2'
                onChange={(value) => setField('AliasTargetZoneId', value)}
              />
            </Box>
          </Stack>
        ) : (
          /* Standard record values */
          <Stack spacing={1}>
            <Box>
              <Text size="xs" sx={{ mb: 0.5 }}>TTL (seconds)</Text>
              <TextField
                size='sm'
                type='number'
                value={String(values.TTL)}
                inputProps={{ min: 0, max: 2147483647 }}
                onChange={(value) => setField('TTL', Number(value))}
                sx={{ maxWidth: 150 }}
              />
            </Box>

            {/* Values list */}
            <Box>
              <Text size="sm" sx={{ fontWeight: 600, mb: 0.5 }}>Values</Text>
              <Stack spacing={0.25}>
                {records.map((val, i) => (
                  <Stack key={i} direction='row' spacing={0.5} alignItems='center'>
                    <Text size="xs" sx={{ fontFamily: 'monospace', flex: 1 }}>{val}</Text>
                    <IconButton size='sm' emphasis='ghost' color='error' onClick={() => handleRemoveValue(i)}>
                      <LuTrash2 size={14} />
                    </IconButton>
                  </Stack>
                ))}
                {records.length === 0 && (
                  <Text size="xs" color="neutral">No values</Text>
                )}
              </Stack>
              <Stack direction='row' spacing={0.5} sx={{ mt: 0.5 }}>
                <TextField
                  size='sm'
                  placeholder={values.Type === 'A' ? '192.0.2.1' : values.Type === 'CNAME' ? 'target.example.com.' : 'value'}
                  value={newValue}
                  onChange={(value) => setNewValue(value)}
                  onKeyDown={handleKeyDown}
                  sx={{ flex: 1, fontSize: 12 }}
                />
                <IconButton size='sm' emphasis='soft' color='primary' disabled={!newValue.trim()} onClick={handleAddValue}>
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
