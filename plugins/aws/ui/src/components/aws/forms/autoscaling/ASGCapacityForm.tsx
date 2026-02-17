import React from 'react';
import { Stack } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import ArrayChipEditor from '../../../shared/forms/ArrayChipEditor';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const HEALTH_CHECK_TYPE_OPTIONS = [
  { label: 'EC2', value: 'EC2' },
  { label: 'ELB', value: 'ELB' },
];

const ASGCapacityForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const { values, setField, dirty, reset } = useFormState({
    DesiredCapacity: data.DesiredCapacity ?? 1,
    MinSize: data.MinSize ?? 0,
    MaxSize: data.MaxSize ?? 1,
    DefaultCooldown: data.DefaultCooldown ?? 300,
    HealthCheckType: data.HealthCheckType ?? 'EC2',
    HealthCheckGracePeriod: data.HealthCheckGracePeriod ?? 300,
    NewInstancesProtectedFromScaleIn: data.NewInstancesProtectedFromScaleIn ?? false,
    CapacityRebalance: data.CapacityRebalance ?? false,
    DefaultInstanceWarmup: data.DefaultInstanceWarmup ?? 0,
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

  const infoFields: FormField[] = [
    { key: 'AutoScalingGroupName', label: 'ASG Name', type: 'readonly', value: data.AutoScalingGroupName },
    { key: 'AutoScalingGroupARN', label: 'ARN', type: 'readonly', value: data.AutoScalingGroupARN },
    { key: 'Status', label: 'Status', type: 'readonly', value: data.Status || 'Active', color: 'success' },
    { key: 'LaunchConfigurationName', label: 'Launch Config', type: 'readonly', value: data.LaunchConfigurationName },
    { key: 'LaunchTemplate', label: 'Launch Template', type: 'readonly', value: data.LaunchTemplate?.LaunchTemplateName },
    { key: 'CreatedTime', label: 'Created', type: 'readonly', value: data.CreatedTime ? String(data.CreatedTime) : undefined },
  ];

  const capacityFields: FormField[] = [
    { key: 'DesiredCapacity', label: 'Desired Capacity', type: 'number', value: values.DesiredCapacity, min: 0, max: 10000 },
    { key: 'MinSize', label: 'Min Size', type: 'number', value: values.MinSize, min: 0, max: 10000 },
    { key: 'MaxSize', label: 'Max Size', type: 'number', value: values.MaxSize, min: 0, max: 10000 },
  ];

  const healthCheckFields: FormField[] = [
    { key: 'HealthCheckType', label: 'Health Check Type', type: 'select', value: values.HealthCheckType, options: HEALTH_CHECK_TYPE_OPTIONS },
    { key: 'HealthCheckGracePeriod', label: 'Grace Period (s)', type: 'number', value: values.HealthCheckGracePeriod, min: 0, max: 7200 },
    { key: 'DefaultCooldown', label: 'Default Cooldown (s)', type: 'number', value: values.DefaultCooldown, min: 0, max: 86400 },
    { key: 'DefaultInstanceWarmup', label: 'Instance Warmup (s)', type: 'number', value: values.DefaultInstanceWarmup, min: 0, max: 3600 },
  ];

  const protectionFields: FormField[] = [
    { key: 'NewInstancesProtectedFromScaleIn', label: 'Scale-In Protection', type: 'switch', value: values.NewInstancesProtectedFromScaleIn },
    { key: 'CapacityRebalance', label: 'Capacity Rebalance', type: 'switch', value: values.CapacityRebalance },
  ];

  const azs = data.AvailabilityZones || [];
  const lbTargetGroups = data.TargetGroupARNs || [];

  return (
    <Stack spacing={1}>
      <FormCard
        title='ASG Info'
        fields={infoFields}
        onChange={() => {}}
        compact
      />
      <FormCard
        title='Capacity'
        fields={capacityFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <FormCard
        title='Health Checks'
        fields={healthCheckFields}
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
        title='Availability Zones'
        items={azs}
        onChange={() => {}}
        readOnly
      />
      {lbTargetGroups.length > 0 && (
        <ArrayChipEditor
          title='Target Groups'
          items={lbTargetGroups}
          onChange={() => {}}
          readOnly
          chipColor='primary'
        />
      )}
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default ASGCapacityForm;
