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

const NodegroupScalingForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const scaling = data.ScalingConfig || {};
  const tags: Tag[] = data.Tags
    ? Object.entries(data.Tags).map(([Key, Value]) => ({ Key, Value: String(Value) }))
    : [];

  const { values, setField, dirty, reset } = useFormState({
    DesiredSize: scaling.DesiredSize ?? 2,
    MinSize: scaling.MinSize ?? 1,
    MaxSize: scaling.MaxSize ?? 3,
  });

  const [tagsState, setTagsState] = React.useState<Tag[]>(tags);
  const tagsDirty = JSON.stringify(tagsState) !== JSON.stringify(tags);
  const allDirty = dirty || tagsDirty;

  const handleSave = () => {
    onSave({
      ScalingConfig: {
        DesiredSize: values.DesiredSize,
        MinSize: values.MinSize,
        MaxSize: values.MaxSize,
      },
      Tags: Object.fromEntries(tagsState.map((t) => [t.Key, t.Value])),
    });
  };

  const handleReset = () => {
    reset();
    setTagsState(tags);
  };

  const scalingFields: FormField[] = [
    { key: 'DesiredSize', label: 'Desired Size', type: 'number', value: values.DesiredSize, min: 0, max: 1000 },
    { key: 'MinSize', label: 'Min Size', type: 'number', value: values.MinSize, min: 0, max: 1000 },
    { key: 'MaxSize', label: 'Max Size', type: 'number', value: values.MaxSize, min: 1, max: 1000 },
  ];

  const infoFields: FormField[] = [
    { key: 'NodegroupName', label: 'Nodegroup', type: 'readonly', value: data.NodegroupName },
    { key: 'ClusterName', label: 'Cluster', type: 'readonly', value: data.ClusterName },
    { key: 'Status', label: 'Status', type: 'readonly', value: data.Status, color: data.Status === 'ACTIVE' ? 'success' : data.Status === 'DEGRADED' ? 'warning' : 'neutral' },
    { key: 'AmiType', label: 'AMI Type', type: 'readonly', value: data.AmiType },
    { key: 'CapacityType', label: 'Capacity Type', type: 'readonly', value: data.CapacityType },
    { key: 'DiskSize', label: 'Disk Size (GB)', type: 'readonly', value: data.DiskSize },
    { key: 'NodeRole', label: 'Node Role', type: 'readonly', value: data.NodeRole },
    { key: 'ReleaseVersion', label: 'Release Version', type: 'readonly', value: data.ReleaseVersion },
    { key: 'Version', label: 'K8s Version', type: 'readonly', value: data.Version },
  ];

  const instanceTypes = data.InstanceTypes || [];
  const subnets = data.Subnets || [];

  return (
    <Stack spacing={1}>
      <FormCard
        title='Scaling Configuration'
        fields={scalingFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <FormCard
        title='Nodegroup Info'
        fields={infoFields}
        onChange={() => {}}
        compact
      />
      <ArrayChipEditor
        title='Instance Types'
        items={instanceTypes}
        onChange={() => {}}
        readOnly
        chipColor='primary'
      />
      <ArrayChipEditor
        title='Subnets'
        items={subnets}
        onChange={() => {}}
        readOnly
        chipColor='neutral'
      />
      <TagEditor
        tags={tagsState}
        onChange={setTagsState}
      />
    </Stack>
  );
};

export default NodegroupScalingForm;
