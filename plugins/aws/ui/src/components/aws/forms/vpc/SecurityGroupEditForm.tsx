import React from 'react';
import { Stack } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import SecurityGroupRuleForm, { type IpPermission } from './SecurityGroupRuleForm';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const SecurityGroupEditForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const { values, setField, dirty, reset } = useFormState({
    Description: data.Description ?? '',
  });

  const [inbound, setInbound] = React.useState<IpPermission[]>(data.IpPermissions || []);
  const [outbound, setOutbound] = React.useState<IpPermission[]>(data.IpPermissionsEgress || []);
  const [tags, setTags] = React.useState<Tag[]>(rawTags);

  const inboundDirty = JSON.stringify(inbound) !== JSON.stringify(data.IpPermissions || []);
  const outboundDirty = JSON.stringify(outbound) !== JSON.stringify(data.IpPermissionsEgress || []);
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const allDirty = dirty || inboundDirty || outboundDirty || tagsDirty;

  const handleSave = () => {
    onSave({
      ...values,
      IpPermissions: inbound,
      IpPermissionsEgress: outbound,
      Tags: tags.map((t) => ({ Key: t.Key, Value: t.Value })),
    });
  };

  const handleReset = () => {
    reset();
    setInbound(data.IpPermissions || []);
    setOutbound(data.IpPermissionsEgress || []);
    setTags(rawTags);
  };

  const infoFields: FormField[] = [
    { key: 'GroupId', label: 'Group ID', type: 'readonly', value: data.GroupId },
    { key: 'GroupName', label: 'Group Name', type: 'readonly', value: data.GroupName },
    { key: 'VpcId', label: 'VPC ID', type: 'readonly', value: data.VpcId },
    { key: 'OwnerId', label: 'Owner', type: 'readonly', value: data.OwnerId },
    { key: 'Description', label: 'Description', type: 'text', value: values.Description },
  ];

  return (
    <Stack spacing={1}>
      <FormCard
        title='Security Group'
        fields={infoFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <SecurityGroupRuleForm
        direction='inbound'
        permissions={inbound}
        onChange={setInbound}
      />
      <SecurityGroupRuleForm
        direction='outbound'
        permissions={outbound}
        onChange={setOutbound}
      />
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default SecurityGroupEditForm;
