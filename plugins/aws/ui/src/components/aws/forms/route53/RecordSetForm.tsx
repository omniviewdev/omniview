import React, { useState } from 'react';
import { Button, IconButton, Stack, Text } from '@omniviewdev/base-ui';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import TextInput from '../../../shared/ui/TextInput';
import SelectInput from '../../../shared/ui/SelectInput';
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
      <Stack spacing={3}>
        {/* Record Name & Type */}
        <Stack direction='row' spacing={2}>
          <div style={{ flex: 2 }}>
            <Text as="div" size="xs" style={{ marginBottom: 4 }}>Record Name</Text>
            <TextInput
              size='sm'
              value={values.Name}
              disabled={!isNew}
              placeholder='subdomain.example.com.'
              onChange={(value) => setField('Name', value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Text as="div" size="xs" style={{ marginBottom: 4 }}>Type</Text>
            <SelectInput
              size='sm'
              value={values.Type}
              disabled={!isNew}
              onChange={(value) => setField('Type', value || 'A')}
              options={RECORD_TYPES}
            />
          </div>
        </Stack>

        {/* Alias toggle */}
        <Stack direction='row' spacing={2} align='center'>
          <Text size="xs">Alias Record</Text>
          <Button
            size='sm'
            variant={values.UseAlias ? 'soft' : 'outline'}
            color={values.UseAlias ? 'brand' : 'neutral'}
            onClick={() => setField('UseAlias', !values.UseAlias)}
          >
            {values.UseAlias ? 'Yes' : 'No'}
          </Button>
        </Stack>

        {values.UseAlias ? (
          /* Alias configuration */
          <Stack spacing={2}>
            <div>
              <Text as="div" size="xs" style={{ marginBottom: 4 }}>Alias Target DNS Name</Text>
              <TextInput
                size='sm'
                value={values.AliasTargetDNS}
                placeholder='d111111abcdef8.cloudfront.net.'
                onChange={(value) => setField('AliasTargetDNS', value)}
              />
            </div>
            <div>
              <Text as="div" size="xs" style={{ marginBottom: 4 }}>Hosted Zone ID</Text>
              <TextInput
                size='sm'
                value={values.AliasTargetZoneId}
                placeholder='Z2FDTNDATAQYW2'
                onChange={(value) => setField('AliasTargetZoneId', value)}
              />
            </div>
          </Stack>
        ) : (
          /* Standard record values */
          <Stack spacing={2}>
            <div>
              <Text as="div" size="xs" style={{ marginBottom: 4 }}>TTL (seconds)</Text>
              <TextInput
                size='sm'
                type='number'
                value={String(values.TTL)}
                inputProps={{ min: 0, max: 2147483647 }}
                onChange={(value) => setField('TTL', Number(value))}
                style={{ maxWidth: 150 }}
              />
            </div>

            {/* Values list */}
            <div>
              <Text as="div" size="sm" style={{ fontWeight: 600, marginBottom: 4 }}>Values</Text>
              <Stack spacing={0} style={{ gap: 2 }}>
                {records.map((val, i) => (
                  <Stack key={i} direction='row' spacing={1} align='center'>
                    <Text size="xs" style={{ fontFamily: 'monospace', flex: 1 }}>{val}</Text>
                    <IconButton size='sm' variant='ghost' color='danger' aria-label='Remove' onClick={() => handleRemoveValue(i)}>
                      <LuTrash2 size={14} />
                    </IconButton>
                  </Stack>
                ))}
                {records.length === 0 && (
                  <Text size="xs" tone='muted'>No values</Text>
                )}
              </Stack>
              <Stack direction='row' spacing={1} style={{ marginTop: 4 }}>
                <TextInput
                  size='sm'
                  placeholder={values.Type === 'A' ? '192.0.2.1' : values.Type === 'CNAME' ? 'target.example.com.' : 'value'}
                  value={newValue}
                  onChange={(value) => setNewValue(value)}
                  onKeyDown={handleKeyDown}
                  style={{ flex: 1 }}
                />
                <IconButton size='sm' variant='soft' color='brand' aria-label='Add' disabled={!newValue.trim()} onClick={handleAddValue}>
                  <LuPlus size={14} />
                </IconButton>
              </Stack>
            </div>
          </Stack>
        )}
      </Stack>
    </FormSection>
  );
};

export default RecordSetForm;
