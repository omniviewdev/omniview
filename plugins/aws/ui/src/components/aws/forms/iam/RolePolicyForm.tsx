import React, { useState } from 'react';
import { Stack } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import ArrayChipEditor from '../../../shared/forms/ArrayChipEditor';
import FormSection from '../../../shared/forms/FormSection';
import CodeEditor from '../../../shared/CodeEditor';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const RolePolicyForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const [tags, setTags] = useState<Tag[]>(rawTags);
  const [trustPolicy, setTrustPolicy] = useState(
    data.AssumeRolePolicyDocument
      ? typeof data.AssumeRolePolicyDocument === 'string'
        ? data.AssumeRolePolicyDocument
        : JSON.stringify(data.AssumeRolePolicyDocument, null, 2)
      : '{}',
  );
  const [maxSessionDuration, setMaxSessionDuration] = useState(data.MaxSessionDuration ?? 3600);
  const [description, setDescription] = useState(data.Description ?? '');

  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const trustDirty = trustPolicy !== (
    typeof data.AssumeRolePolicyDocument === 'string'
      ? data.AssumeRolePolicyDocument
      : JSON.stringify(data.AssumeRolePolicyDocument, null, 2)
  );
  const fieldsDirty = maxSessionDuration !== (data.MaxSessionDuration ?? 3600)
    || description !== (data.Description ?? '');
  const allDirty = tagsDirty || trustDirty || fieldsDirty;

  const handleSave = () => {
    onSave({
      Description: description,
      MaxSessionDuration: maxSessionDuration,
      AssumeRolePolicyDocument: trustPolicy,
      Tags: tags.map((t) => ({ Key: t.Key, Value: t.Value })),
    });
  };

  const infoFields: FormField[] = [
    { key: 'RoleName', label: 'Role Name', type: 'readonly', value: data.RoleName },
    { key: 'RoleId', label: 'Role ID', type: 'readonly', value: data.RoleId },
    { key: 'Arn', label: 'ARN', type: 'readonly', value: data.Arn },
    { key: 'Path', label: 'Path', type: 'readonly', value: data.Path },
    { key: 'CreateDate', label: 'Created', type: 'readonly', value: data.CreateDate ? String(data.CreateDate) : undefined },
    { key: 'Description', label: 'Description', type: 'text', value: description },
    { key: 'MaxSessionDuration', label: 'Max Session (s)', type: 'number', value: maxSessionDuration, min: 3600, max: 43200 },
  ];

  const handleFieldChange = (key: string, value: any) => {
    if (key === 'Description') setDescription(value);
    if (key === 'MaxSessionDuration') setMaxSessionDuration(value);
  };

  const attachedPolicies = (data.AttachedManagedPolicies || []).map(
    (p: any) => p.PolicyName || p.PolicyArn || ''
  );

  const inlinePolicies = data.RolePolicyList
    ? (data.RolePolicyList as any[]).map((p) => p.PolicyName || '')
    : [];

  return (
    <Stack spacing={1}>
      <FormCard
        title='Role Info'
        fields={infoFields}
        onChange={handleFieldChange}
        onSave={handleSave}
        onReset={() => {
          setDescription(data.Description ?? '');
          setMaxSessionDuration(data.MaxSessionDuration ?? 3600);
          setTags(rawTags);
          setTrustPolicy(
            typeof data.AssumeRolePolicyDocument === 'string'
              ? data.AssumeRolePolicyDocument
              : JSON.stringify(data.AssumeRolePolicyDocument, null, 2)
          );
        }}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <FormSection
        title='Trust Policy'
        description='JSON trust relationship policy document'
      >
        <CodeEditor
          value={trustPolicy}
          onChange={setTrustPolicy}
          language='json'
          filename='trust-policy.json'
          height={200}
        />
      </FormSection>
      <ArrayChipEditor
        title='Attached Managed Policies'
        items={attachedPolicies}
        onChange={() => {}}
        readOnly
        chipColor='primary'
      />
      {inlinePolicies.length > 0 && (
        <ArrayChipEditor
          title='Inline Policies'
          items={inlinePolicies}
          onChange={() => {}}
          readOnly
          chipColor='warning'
        />
      )}
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default RolePolicyForm;
