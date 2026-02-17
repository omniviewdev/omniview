import React from 'react';
import { Stack } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import ArrayChipEditor from '../../../shared/forms/ArrayChipEditor';
import FormSection from '../../../shared/forms/FormSection';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
  onTerminate?: () => void;
  onStop?: () => void;
  onStart?: () => void;
  terminateLoading?: boolean;
};

const INSTANCE_TYPES = [
  { label: 't2.nano', value: 't2.nano' },
  { label: 't2.micro', value: 't2.micro' },
  { label: 't2.small', value: 't2.small' },
  { label: 't2.medium', value: 't2.medium' },
  { label: 't2.large', value: 't2.large' },
  { label: 't3.nano', value: 't3.nano' },
  { label: 't3.micro', value: 't3.micro' },
  { label: 't3.small', value: 't3.small' },
  { label: 't3.medium', value: 't3.medium' },
  { label: 't3.large', value: 't3.large' },
  { label: 't3.xlarge', value: 't3.xlarge' },
  { label: 'm5.large', value: 'm5.large' },
  { label: 'm5.xlarge', value: 'm5.xlarge' },
  { label: 'm5.2xlarge', value: 'm5.2xlarge' },
  { label: 'c5.large', value: 'c5.large' },
  { label: 'c5.xlarge', value: 'c5.xlarge' },
  { label: 'r5.large', value: 'r5.large' },
  { label: 'r5.xlarge', value: 'r5.xlarge' },
];

const InstanceConfigForm: React.FC<Props> = ({ data, onSave, saving, onTerminate, onStop, onStart, terminateLoading }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const isStopped = data.State?.Name === 'stopped';

  const { values, setField, dirty, reset } = useFormState({
    InstanceType: data.InstanceType ?? '',
    DisableApiTermination: data.DisableApiTermination ?? false,
    InstanceInitiatedShutdownBehavior: data.InstanceInitiatedShutdownBehavior ?? 'stop',
    EbsOptimized: data.EbsOptimized ?? false,
    Monitoring: data.Monitoring?.State === 'enabled',
    SourceDestCheck: data.SourceDestCheck ?? true,
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

  const stateColor = data.State?.Name === 'running' ? 'success' as const
    : data.State?.Name === 'stopped' ? 'danger' as const
    : 'warning' as const;

  const identityFields: FormField[] = [
    { key: 'InstanceId', label: 'Instance ID', type: 'readonly', value: data.InstanceId },
    { key: 'State', label: 'State', type: 'readonly', value: data.State?.Name, color: stateColor },
    { key: 'ImageId', label: 'AMI ID', type: 'readonly', value: data.ImageId },
    { key: 'LaunchTime', label: 'Launched', type: 'readonly', value: data.LaunchTime ? String(data.LaunchTime) : undefined },
    { key: 'Platform', label: 'Platform', type: 'readonly', value: data.PlatformDetails || data.Platform },
    { key: 'Architecture', label: 'Architecture', type: 'readonly', value: data.Architecture },
    { key: 'KeyName', label: 'Key Pair', type: 'readonly', value: data.KeyName },
  ];

  const computeFields: FormField[] = [
    {
      key: 'InstanceType',
      label: 'Instance Type',
      type: isStopped ? 'select' : 'readonly',
      value: values.InstanceType,
      ...(isStopped ? { options: INSTANCE_TYPES } : {}),
    } as FormField,
    { key: 'EbsOptimized', label: 'EBS Optimized', type: 'switch', value: values.EbsOptimized },
    { key: 'Monitoring', label: 'Detailed Monitoring', type: 'switch', value: values.Monitoring },
  ];

  const networkFields: FormField[] = [
    { key: 'VpcId', label: 'VPC ID', type: 'readonly', value: data.VpcId },
    { key: 'SubnetId', label: 'Subnet ID', type: 'readonly', value: data.SubnetId },
    { key: 'PrivateIpAddress', label: 'Private IP', type: 'readonly', value: data.PrivateIpAddress },
    { key: 'PublicIpAddress', label: 'Public IP', type: 'readonly', value: data.PublicIpAddress },
    { key: 'PublicDnsName', label: 'Public DNS', type: 'readonly', value: data.PublicDnsName },
    { key: 'PrivateDnsName', label: 'Private DNS', type: 'readonly', value: data.PrivateDnsName },
    { key: 'SourceDestCheck', label: 'Source/Dest Check', type: 'switch', value: values.SourceDestCheck },
  ];

  const protectionFields: FormField[] = [
    { key: 'DisableApiTermination', label: 'Termination Protection', type: 'switch', value: values.DisableApiTermination },
    {
      key: 'InstanceInitiatedShutdownBehavior',
      label: 'Shutdown Behavior',
      type: 'select',
      value: values.InstanceInitiatedShutdownBehavior,
      options: [
        { label: 'Stop', value: 'stop' },
        { label: 'Terminate', value: 'terminate' },
      ],
    },
  ];

  const securityGroups = (data.SecurityGroups || []).map(
    (sg: any) => `${sg.GroupId} (${sg.GroupName || ''})`
  );

  const blockDevices = (data.BlockDeviceMappings || []).map(
    (bd: any) => `${bd.DeviceName} → ${bd.Ebs?.VolumeId || 'N/A'}`
  );

  return (
    <Stack spacing={1}>
      <FormCard
        title='Instance Identity'
        fields={identityFields}
        onChange={() => {}}
        compact
      />
      <FormCard
        title='Compute'
        fields={computeFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <FormCard
        title='Networking'
        fields={networkFields}
        onChange={setField}
        compact
      />
      <FormCard
        title='Protection'
        fields={protectionFields}
        onChange={setField}
        compact
      />
      <ArrayChipEditor
        title='Security Groups'
        items={securityGroups}
        onChange={() => {}}
        readOnly
        chipColor='neutral'
      />
      <ArrayChipEditor
        title='Block Devices'
        items={blockDevices}
        onChange={() => {}}
        readOnly
        chipColor='neutral'
      />
      <TagEditor tags={tags} onChange={setTags} />
      {/* Actions */}
      {(onStop || onStart || onTerminate) && (
        <FormSection
          title='Instance Actions'
          description='Start, stop, or terminate this instance'
          dangerAction={onTerminate ? {
            label: 'Terminate',
            onClick: onTerminate,
            loading: terminateLoading,
          } : undefined}
        >
          <Stack direction='row' spacing={1}>
            {onStop && data.State?.Name === 'running' && (
              <button onClick={onStop}>Stop Instance</button>
            )}
            {onStart && data.State?.Name === 'stopped' && (
              <button onClick={onStart}>Start Instance</button>
            )}
          </Stack>
        </FormSection>
      )}
    </Stack>
  );
};

export default InstanceConfigForm;
