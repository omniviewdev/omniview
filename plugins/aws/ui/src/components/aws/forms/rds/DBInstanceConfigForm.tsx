import React from 'react';
import { Stack } from '@omniviewdev/ui/layout';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import ArrayChipEditor from '../../../shared/forms/ArrayChipEditor';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const DB_INSTANCE_CLASSES = [
  { label: 'db.t3.micro', value: 'db.t3.micro' },
  { label: 'db.t3.small', value: 'db.t3.small' },
  { label: 'db.t3.medium', value: 'db.t3.medium' },
  { label: 'db.t3.large', value: 'db.t3.large' },
  { label: 'db.t3.xlarge', value: 'db.t3.xlarge' },
  { label: 'db.t4g.micro', value: 'db.t4g.micro' },
  { label: 'db.t4g.small', value: 'db.t4g.small' },
  { label: 'db.t4g.medium', value: 'db.t4g.medium' },
  { label: 'db.t4g.large', value: 'db.t4g.large' },
  { label: 'db.r6g.large', value: 'db.r6g.large' },
  { label: 'db.r6g.xlarge', value: 'db.r6g.xlarge' },
  { label: 'db.r6g.2xlarge', value: 'db.r6g.2xlarge' },
  { label: 'db.m6g.large', value: 'db.m6g.large' },
  { label: 'db.m6g.xlarge', value: 'db.m6g.xlarge' },
];

const DBInstanceConfigForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.TagList)
    ? data.TagList.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const { values, setField, dirty, reset } = useFormState({
    DBInstanceClass: data.DBInstanceClass ?? '',
    AllocatedStorage: data.AllocatedStorage ?? 20,
    MaxAllocatedStorage: data.MaxAllocatedStorage ?? 0,
    MultiAZ: data.MultiAZ ?? false,
    BackupRetentionPeriod: data.BackupRetentionPeriod ?? 7,
    PreferredBackupWindow: data.PreferredBackupWindow ?? '',
    PreferredMaintenanceWindow: data.PreferredMaintenanceWindow ?? '',
    AutoMinorVersionUpgrade: data.AutoMinorVersionUpgrade ?? true,
    DeletionProtection: data.DeletionProtection ?? false,
    CopyTagsToSnapshot: data.CopyTagsToSnapshot ?? false,
    PubliclyAccessible: data.PubliclyAccessible ?? false,
    StorageEncrypted: data.StorageEncrypted ?? false,
    PerformanceInsightsEnabled: data.PerformanceInsightsEnabled ?? false,
    MonitoringInterval: data.MonitoringInterval ?? 0,
  });

  const [tags, setTags] = React.useState<Tag[]>(rawTags);
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const allDirty = dirty || tagsDirty;

  const handleSave = () => {
    onSave({ ...values, TagList: tags });
  };

  const handleReset = () => {
    reset();
    setTags(rawTags);
  };

  const statusColor = data.DBInstanceStatus === 'available' ? 'success' as const
    : data.DBInstanceStatus === 'creating' || data.DBInstanceStatus === 'modifying' ? 'warning' as const
    : data.DBInstanceStatus === 'failed' || data.DBInstanceStatus === 'deleting' ? 'danger' as const
    : 'neutral' as const;

  const identityFields: FormField[] = [
    { key: 'DBInstanceIdentifier', label: 'DB Identifier', type: 'readonly', value: data.DBInstanceIdentifier },
    { key: 'DBInstanceStatus', label: 'Status', type: 'readonly', value: data.DBInstanceStatus, color: statusColor },
    { key: 'Engine', label: 'Engine', type: 'readonly', value: data.Engine },
    { key: 'EngineVersion', label: 'Engine Version', type: 'readonly', value: data.EngineVersion },
    { key: 'DBInstanceArn', label: 'ARN', type: 'readonly', value: data.DBInstanceArn },
    { key: 'Endpoint', label: 'Endpoint', type: 'readonly', value: data.Endpoint?.Address },
    { key: 'Port', label: 'Port', type: 'readonly', value: data.Endpoint?.Port },
    { key: 'MasterUsername', label: 'Master Username', type: 'readonly', value: data.MasterUsername },
    { key: 'AvailabilityZone', label: 'AZ', type: 'readonly', value: data.AvailabilityZone },
  ];

  const computeFields: FormField[] = [
    { key: 'DBInstanceClass', label: 'Instance Class', type: 'select', value: values.DBInstanceClass, options: DB_INSTANCE_CLASSES },
    { key: 'MultiAZ', label: 'Multi-AZ', type: 'switch', value: values.MultiAZ },
    { key: 'PubliclyAccessible', label: 'Publicly Accessible', type: 'switch', value: values.PubliclyAccessible },
  ];

  const storageFields: FormField[] = [
    { key: 'StorageType', label: 'Storage Type', type: 'readonly', value: data.StorageType },
    { key: 'AllocatedStorage', label: 'Allocated Storage (GB)', type: 'number', value: values.AllocatedStorage, min: 20, max: 65536 },
    { key: 'MaxAllocatedStorage', label: 'Max Storage (GB)', type: 'number', value: values.MaxAllocatedStorage, min: 0, max: 65536 },
    { key: 'StorageEncrypted', label: 'Encrypted', type: 'readonly', value: values.StorageEncrypted },
    { key: 'Iops', label: 'IOPS', type: 'readonly', value: data.Iops },
  ];

  const backupFields: FormField[] = [
    { key: 'BackupRetentionPeriod', label: 'Backup Retention (days)', type: 'number', value: values.BackupRetentionPeriod, min: 0, max: 35 },
    { key: 'PreferredBackupWindow', label: 'Backup Window', type: 'text', value: values.PreferredBackupWindow, placeholder: 'hh:mm-hh:mm' },
    { key: 'PreferredMaintenanceWindow', label: 'Maintenance Window', type: 'text', value: values.PreferredMaintenanceWindow, placeholder: 'ddd:hh:mm-ddd:hh:mm' },
    { key: 'CopyTagsToSnapshot', label: 'Copy Tags to Snapshot', type: 'switch', value: values.CopyTagsToSnapshot },
  ];

  const protectionFields: FormField[] = [
    { key: 'DeletionProtection', label: 'Deletion Protection', type: 'switch', value: values.DeletionProtection },
    { key: 'AutoMinorVersionUpgrade', label: 'Auto Minor Upgrade', type: 'switch', value: values.AutoMinorVersionUpgrade },
  ];

  const monitoringFields: FormField[] = [
    { key: 'PerformanceInsightsEnabled', label: 'Performance Insights', type: 'switch', value: values.PerformanceInsightsEnabled },
    { key: 'MonitoringInterval', label: 'Enhanced Monitoring (s)', type: 'number', value: values.MonitoringInterval, min: 0, max: 60 },
  ];

  const securityGroups = (data.VpcSecurityGroups || []).map(
    (sg: any) => `${sg.VpcSecurityGroupId} (${sg.Status || 'unknown'})`
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
        title='Storage'
        fields={storageFields}
        onChange={setField}
        compact
      />
      <FormCard
        title='Backup & Maintenance'
        fields={backupFields}
        onChange={setField}
        compact
      />
      <FormCard
        title='Protection'
        fields={protectionFields}
        onChange={setField}
        compact
      />
      <FormCard
        title='Monitoring'
        fields={monitoringFields}
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
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default DBInstanceConfigForm;
