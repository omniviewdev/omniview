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

const ENCRYPTION_OPTIONS = [
  { label: 'None', value: '' },
  { label: 'SSE-S3 (AES256)', value: 'AES256' },
  { label: 'SSE-KMS', value: 'aws:kms' },
  { label: 'SSE-KMS (DSSE)', value: 'aws:kms:dsse' },
];

const BucketPropertiesForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const { values, setField, dirty, reset } = useFormState({
    Versioning: data.Versioning?.Status === 'Enabled',
    MFADelete: data.Versioning?.MFADelete === 'Enabled',
    BlockPublicAcls: data.PublicAccessBlockConfiguration?.BlockPublicAcls ?? true,
    IgnorePublicAcls: data.PublicAccessBlockConfiguration?.IgnorePublicAcls ?? true,
    BlockPublicPolicy: data.PublicAccessBlockConfiguration?.BlockPublicPolicy ?? true,
    RestrictPublicBuckets: data.PublicAccessBlockConfiguration?.RestrictPublicBuckets ?? true,
    ServerSideEncryption: data.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm ?? '',
    ObjectLockEnabled: data.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled',
  });

  const [tags, setTags] = React.useState<Tag[]>(rawTags);
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const allDirty = dirty || tagsDirty;

  const handleSave = () => {
    onSave({
      ...values,
      Tags: tags,
    });
  };

  const handleReset = () => {
    reset();
    setTags(rawTags);
  };

  const bucketInfoFields: FormField[] = [
    { key: 'BucketName', label: 'Bucket Name', type: 'readonly', value: data.Name || data.BucketName },
    { key: 'Region', label: 'Region', type: 'readonly', value: data._Region || data.Region },
    { key: 'CreationDate', label: 'Created', type: 'readonly', value: data.CreationDate ? String(data.CreationDate) : undefined },
    { key: 'Arn', label: 'ARN', type: 'readonly', value: data.Arn || `arn:aws:s3:::${data.Name || data.BucketName}` },
  ];

  const versioningFields: FormField[] = [
    { key: 'Versioning', label: 'Versioning', type: 'switch', value: values.Versioning },
    { key: 'MFADelete', label: 'MFA Delete', type: 'switch', value: values.MFADelete },
    { key: 'ObjectLockEnabled', label: 'Object Lock', type: 'readonly', value: values.ObjectLockEnabled },
  ];

  const publicAccessFields: FormField[] = [
    { key: 'BlockPublicAcls', label: 'Block Public ACLs', type: 'switch', value: values.BlockPublicAcls },
    { key: 'IgnorePublicAcls', label: 'Ignore Public ACLs', type: 'switch', value: values.IgnorePublicAcls },
    { key: 'BlockPublicPolicy', label: 'Block Public Policy', type: 'switch', value: values.BlockPublicPolicy },
    { key: 'RestrictPublicBuckets', label: 'Restrict Public Buckets', type: 'switch', value: values.RestrictPublicBuckets },
  ];

  const encryptionFields: FormField[] = [
    { key: 'ServerSideEncryption', label: 'Encryption', type: 'select', value: values.ServerSideEncryption, options: ENCRYPTION_OPTIONS },
  ];

  const corsOrigins = (data.CORSConfiguration?.CORSRules || []).flatMap(
    (rule: any) => rule.AllowedOrigins || []
  );

  return (
    <Stack spacing={1}>
      <FormCard
        title='Bucket Info'
        fields={bucketInfoFields}
        onChange={() => {}}
        compact
      />
      <FormCard
        title='Versioning'
        fields={versioningFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <FormCard
        title='Public Access'
        fields={publicAccessFields}
        onChange={setField}
        compact
      />
      <FormCard
        title='Encryption'
        fields={encryptionFields}
        onChange={setField}
        compact
      />
      {corsOrigins.length > 0 && (
        <ArrayChipEditor
          title='CORS Origins'
          items={corsOrigins}
          onChange={() => {}}
          readOnly
          chipColor='primary'
        />
      )}
      <TagEditor
        tags={tags}
        onChange={setTags}
      />
    </Stack>
  );
};

export default BucketPropertiesForm;
