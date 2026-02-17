import React from 'react';
import { Stack } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import ArrayChipEditor from '../../../shared/forms/ArrayChipEditor';
import KeyValueEditor from '../../../shared/forms/KeyValueEditor';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const LaunchTemplateForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const templateData = data.LaunchTemplateData || data;

  const rawTags: Tag[] = Array.isArray(templateData.TagSpecifications?.[0]?.Tags)
    ? templateData.TagSpecifications[0].Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const { values, setField, dirty, reset } = useFormState({
    InstanceType: templateData.InstanceType ?? '',
    ImageId: templateData.ImageId ?? '',
    KeyName: templateData.KeyName ?? '',
    EbsOptimized: templateData.EbsOptimized ?? false,
    DisableApiTermination: templateData.DisableApiTermination ?? false,
    Monitoring: templateData.Monitoring?.Enabled ?? false,
  });

  const [tags, setTags] = React.useState<Tag[]>(rawTags);
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const allDirty = dirty || tagsDirty;

  const handleSave = () => {
    onSave({ ...values, Tags: tags });
  };

  const handleReset = () => {
    reset();
    setTags(rawTags);
  };

  const infoFields: FormField[] = [
    { key: 'LaunchTemplateName', label: 'Template Name', type: 'readonly', value: data.LaunchTemplateName },
    { key: 'LaunchTemplateId', label: 'Template ID', type: 'readonly', value: data.LaunchTemplateId },
    { key: 'VersionNumber', label: 'Version', type: 'readonly', value: data.VersionNumber || data.LatestVersionNumber },
    { key: 'DefaultVersionNumber', label: 'Default Version', type: 'readonly', value: data.DefaultVersionNumber },
    { key: 'CreatedBy', label: 'Created By', type: 'readonly', value: data.CreatedBy },
  ];

  const instanceFields: FormField[] = [
    { key: 'InstanceType', label: 'Instance Type', type: 'text', value: values.InstanceType, placeholder: 't3.micro' },
    { key: 'ImageId', label: 'AMI ID', type: 'text', value: values.ImageId, placeholder: 'ami-xxxxxxxxx' },
    { key: 'KeyName', label: 'Key Pair', type: 'text', value: values.KeyName, placeholder: 'my-key-pair' },
    { key: 'EbsOptimized', label: 'EBS Optimized', type: 'switch', value: values.EbsOptimized },
    { key: 'DisableApiTermination', label: 'Termination Protection', type: 'switch', value: values.DisableApiTermination },
    { key: 'Monitoring', label: 'Detailed Monitoring', type: 'switch', value: values.Monitoring },
  ];

  const securityGroups = templateData.SecurityGroupIds || templateData.SecurityGroups || [];

  const networkInterfaces = (templateData.NetworkInterfaces || []).map(
    (ni: any) => `${ni.DeviceIndex ?? 0}: ${ni.SubnetId || 'default'} (${ni.AssociatePublicIpAddress ? 'public' : 'private'})`
  );

  const blockDevices = (templateData.BlockDeviceMappings || []).map(
    (bd: any) => `${bd.DeviceName}: ${bd.Ebs?.VolumeSize || '?'}GB ${bd.Ebs?.VolumeType || ''}`
  );

  // UserData (base64 decode if present)
  const userData: Record<string, string> = {};
  if (templateData.UserData) {
    userData['UserData'] = '(base64 encoded, present)';
  }

  return (
    <Stack spacing={1}>
      <FormCard
        title='Launch Template Info'
        fields={infoFields}
        onChange={() => {}}
        compact
      />
      <FormCard
        title='Instance Configuration'
        fields={instanceFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <ArrayChipEditor
        title='Security Groups'
        items={securityGroups}
        onChange={() => {}}
        readOnly
        chipColor='neutral'
      />
      {networkInterfaces.length > 0 && (
        <ArrayChipEditor
          title='Network Interfaces'
          items={networkInterfaces}
          onChange={() => {}}
          readOnly
          chipColor='neutral'
        />
      )}
      {blockDevices.length > 0 && (
        <ArrayChipEditor
          title='Block Devices'
          items={blockDevices}
          onChange={() => {}}
          readOnly
          chipColor='neutral'
        />
      )}
      {Object.keys(userData).length > 0 && (
        <KeyValueEditor
          title='User Data'
          entries={userData}
          onChange={() => {}}
          readOnly
        />
      )}
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default LaunchTemplateForm;
