import React from 'react';
import { Stack } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const VOLUME_TYPES = [
  { label: 'gp3', value: 'gp3' },
  { label: 'gp2', value: 'gp2' },
  { label: 'io1', value: 'io1' },
  { label: 'io2', value: 'io2' },
  { label: 'st1', value: 'st1' },
  { label: 'sc1', value: 'sc1' },
  { label: 'standard', value: 'standard' },
];

const VolumeConfigForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const { values, setField, dirty, reset } = useFormState({
    VolumeType: data.VolumeType ?? 'gp3',
    Size: data.Size ?? 8,
    Iops: data.Iops ?? 3000,
    Throughput: data.Throughput ?? 125,
    MultiAttachEnabled: data.MultiAttachEnabled ?? false,
  });

  const [tags, setTags] = React.useState<Tag[]>(rawTags);
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const allDirty = dirty || tagsDirty;

  const handleSave = () => {
    onSave({
      ...values,
      Tags: tags.map((t) => ({ Key: t.Key, Value: t.Value })),
    });
  };

  const handleReset = () => {
    reset();
    setTags(rawTags);
  };

  const stateColor = data.State === 'available' || data.State === 'in-use' ? 'success' as const
    : data.State === 'creating' ? 'warning' as const
    : data.State === 'deleting' || data.State === 'error' ? 'danger' as const
    : 'neutral' as const;

  const identityFields: FormField[] = [
    { key: 'VolumeId', label: 'Volume ID', type: 'readonly', value: data.VolumeId },
    { key: 'State', label: 'State', type: 'readonly', value: data.State, color: stateColor },
    { key: 'AvailabilityZone', label: 'AZ', type: 'readonly', value: data.AvailabilityZone },
    { key: 'Encrypted', label: 'Encrypted', type: 'readonly', value: data.Encrypted },
    { key: 'KmsKeyId', label: 'KMS Key', type: 'readonly', value: data.KmsKeyId },
    { key: 'SnapshotId', label: 'Source Snapshot', type: 'readonly', value: data.SnapshotId },
    { key: 'CreateTime', label: 'Created', type: 'readonly', value: data.CreateTime ? String(data.CreateTime) : undefined },
  ];

  const showIops = ['io1', 'io2', 'gp3'].includes(values.VolumeType);
  const showThroughput = values.VolumeType === 'gp3';

  const storageFields: FormField[] = [
    { key: 'VolumeType', label: 'Volume Type', type: 'select', value: values.VolumeType, options: VOLUME_TYPES },
    { key: 'Size', label: 'Size (GiB)', type: 'number', value: values.Size, min: 1, max: 16384 },
    ...(showIops ? [{ key: 'Iops', label: 'IOPS', type: 'number' as const, value: values.Iops, min: 100, max: 64000 }] : []),
    ...(showThroughput ? [{ key: 'Throughput', label: 'Throughput (MiB/s)', type: 'number' as const, value: values.Throughput, min: 125, max: 1000 }] : []),
    { key: 'MultiAttachEnabled', label: 'Multi-Attach', type: 'switch', value: values.MultiAttachEnabled },
  ];

  // Attachments
  const attachments = (data.Attachments || []).map(
    (att: any) => `${att.InstanceId || 'unknown'} (${att.Device || ''}, ${att.State || ''})`
  );

  const attachInfoFields: FormField[] = attachments.length > 0
    ? attachments.map((att: string, i: number) => ({
        key: `attachment-${i}`,
        label: `Attachment ${i + 1}`,
        type: 'readonly' as const,
        value: att,
      }))
    : [{ key: 'no-attach', label: 'Attachments', type: 'readonly' as const, value: 'Not attached' }];

  return (
    <Stack spacing={1}>
      <FormCard
        title='Volume Identity'
        fields={identityFields}
        onChange={() => {}}
        compact
      />
      <FormCard
        title='Storage Configuration'
        fields={storageFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <FormCard
        title='Attachments'
        fields={attachInfoFields}
        onChange={() => {}}
        compact
      />
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default VolumeConfigForm;
