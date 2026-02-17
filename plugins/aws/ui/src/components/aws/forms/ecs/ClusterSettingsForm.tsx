import React from 'react';
import { Stack } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import ArrayChipEditor from '../../../shared/forms/ArrayChipEditor';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const ClusterSettingsForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  // Extract settings
  const containerInsights = (data.Settings || []).find(
    (s: any) => s.Name === 'containerInsights'
  );

  const { values, setField, dirty, reset } = useFormState({
    ContainerInsights: containerInsights?.Value === 'enabled',
  });

  const [tags, setTags] = React.useState<Tag[]>(rawTags);
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const allDirty = dirty || tagsDirty;

  const handleSave = () => {
    onSave({
      Settings: [
        { Name: 'containerInsights', Value: values.ContainerInsights ? 'enabled' : 'disabled' },
      ],
      Tags: tags.map((t) => ({ Key: t.Key, Value: t.Value })),
    });
  };

  const handleReset = () => {
    reset();
    setTags(rawTags);
  };

  const statusColor = data.Status === 'ACTIVE' ? 'success' as const
    : data.Status === 'PROVISIONING' ? 'warning' as const
    : 'neutral' as const;

  const infoFields: FormField[] = [
    { key: 'ClusterName', label: 'Cluster Name', type: 'readonly', value: data.ClusterName },
    { key: 'ClusterArn', label: 'ARN', type: 'readonly', value: data.ClusterArn },
    { key: 'Status', label: 'Status', type: 'readonly', value: data.Status, color: statusColor },
    { key: 'ActiveServicesCount', label: 'Active Services', type: 'readonly', value: data.ActiveServicesCount },
    { key: 'RunningTasksCount', label: 'Running Tasks', type: 'readonly', value: data.RunningTasksCount },
    { key: 'PendingTasksCount', label: 'Pending Tasks', type: 'readonly', value: data.PendingTasksCount },
    { key: 'RegisteredContainerInstancesCount', label: 'Container Instances', type: 'readonly', value: data.RegisteredContainerInstancesCount },
  ];

  const settingFields: FormField[] = [
    { key: 'ContainerInsights', label: 'Container Insights', type: 'switch', value: values.ContainerInsights },
  ];

  const capacityProviders = data.CapacityProviders || [];
  const defaultCapacityProviderStrategy = (data.DefaultCapacityProviderStrategy || []).map(
    (s: any) => `${s.CapacityProvider} (base: ${s.Base ?? 0}, weight: ${s.Weight ?? 0})`
  );

  return (
    <Stack spacing={1}>
      <FormCard
        title='Cluster Info'
        fields={infoFields}
        onChange={() => {}}
        compact
      />
      <FormCard
        title='Settings'
        fields={settingFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      {capacityProviders.length > 0 && (
        <ArrayChipEditor
          title='Capacity Providers'
          items={capacityProviders}
          onChange={() => {}}
          readOnly
          chipColor='primary'
        />
      )}
      {defaultCapacityProviderStrategy.length > 0 && (
        <ArrayChipEditor
          title='Default Capacity Provider Strategy'
          items={defaultCapacityProviderStrategy}
          onChange={() => {}}
          readOnly
          chipColor='neutral'
        />
      )}
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default ClusterSettingsForm;
