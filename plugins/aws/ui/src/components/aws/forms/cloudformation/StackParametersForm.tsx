import React from 'react';
import { Stack, Typography } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import FormSection from '../../../shared/forms/FormSection';
import CodeEditor from '../../../shared/CodeEditor';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const StackParametersForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  // Build initial parameter values
  const params: Array<{ ParameterKey: string; ParameterValue: string }> = data.Parameters || [];
  const initialParamValues: Record<string, string> = {};
  for (const p of params) {
    initialParamValues[p.ParameterKey] = p.ParameterValue || '';
  }

  const { values: paramValues, setField: setParamField, dirty: paramsDirty, reset: resetParams } = useFormState(initialParamValues);

  const { values, setField, dirty, reset } = useFormState({
    EnableTerminationProtection: data.EnableTerminationProtection ?? false,
    RollbackConfiguration: data.RollbackConfiguration?.MonitoringTimeInMinutes ?? 0,
  });

  const [tags, setTags] = React.useState<Tag[]>(rawTags);
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const allDirty = dirty || paramsDirty || tagsDirty;

  const handleSave = () => {
    onSave({
      ...values,
      Parameters: Object.entries(paramValues).map(([ParameterKey, ParameterValue]) => ({
        ParameterKey,
        ParameterValue,
      })),
      Tags: tags.map((t) => ({ Key: t.Key, Value: t.Value })),
    });
  };

  const handleReset = () => {
    reset();
    resetParams();
    setTags(rawTags);
  };

  const statusColor = data.StackStatus?.includes('COMPLETE') && !data.StackStatus?.includes('ROLLBACK')
    ? 'success' as const
    : data.StackStatus?.includes('IN_PROGRESS') ? 'warning' as const
    : data.StackStatus?.includes('FAILED') || data.StackStatus?.includes('ROLLBACK') ? 'danger' as const
    : 'neutral' as const;

  const infoFields: FormField[] = [
    { key: 'StackName', label: 'Stack Name', type: 'readonly', value: data.StackName },
    { key: 'StackId', label: 'Stack ID', type: 'readonly', value: data.StackId },
    { key: 'StackStatus', label: 'Status', type: 'readonly', value: data.StackStatus, color: statusColor },
    { key: 'StackStatusReason', label: 'Status Reason', type: 'readonly', value: data.StackStatusReason },
    { key: 'CreationTime', label: 'Created', type: 'readonly', value: data.CreationTime ? String(data.CreationTime) : undefined },
    { key: 'LastUpdatedTime', label: 'Updated', type: 'readonly', value: data.LastUpdatedTime ? String(data.LastUpdatedTime) : undefined },
    { key: 'RoleARN', label: 'IAM Role', type: 'readonly', value: data.RoleARN },
    { key: 'Description', label: 'Description', type: 'readonly', value: data.Description },
  ];

  const protectionFields: FormField[] = [
    { key: 'EnableTerminationProtection', label: 'Termination Protection', type: 'switch', value: values.EnableTerminationProtection },
    { key: 'RollbackConfiguration', label: 'Rollback Monitoring (min)', type: 'number', value: values.RollbackConfiguration, min: 0, max: 180 },
  ];

  // Build parameter fields dynamically
  const parameterFields: FormField[] = params.map((p) => ({
    key: p.ParameterKey,
    label: p.ParameterKey,
    type: 'text' as const,
    value: paramValues[p.ParameterKey] || '',
    placeholder: p.ParameterValue || '',
  }));

  // Outputs
  const outputs: Array<{ OutputKey: string; OutputValue: string; Description?: string }> = data.Outputs || [];

  // Template body (if available)
  const templateBody = data.TemplateBody || '';

  return (
    <Stack spacing={1}>
      <FormCard
        title='Stack Info'
        fields={infoFields}
        onChange={() => {}}
        compact
      />
      {parameterFields.length > 0 && (
        <FormCard
          title='Parameters'
          fields={parameterFields}
          onChange={setParamField}
          onSave={handleSave}
          onReset={handleReset}
          dirty={allDirty}
          saving={saving}
        />
      )}
      <FormCard
        title='Protection'
        fields={protectionFields}
        onChange={setField}
        compact
      />
      {outputs.length > 0 && (
        <FormSection title='Outputs' description='Stack output values'>
          <Stack spacing={0.5}>
            {outputs.map((out) => (
              <Stack key={out.OutputKey} direction='row' spacing={1}>
                <Typography level='body-xs' sx={{ minWidth: 150, fontWeight: 700 }}>{out.OutputKey}</Typography>
                <Typography level='body-xs' fontFamily='monospace'>{out.OutputValue}</Typography>
                {out.Description && (
                  <Typography level='body-xs' color='neutral'>({out.Description})</Typography>
                )}
              </Stack>
            ))}
          </Stack>
        </FormSection>
      )}
      {templateBody && (
        <FormSection title='Template' description='CloudFormation template'>
          <CodeEditor
            value={typeof templateBody === 'string' ? templateBody : JSON.stringify(templateBody, null, 2)}
            language={typeof templateBody === 'string' && templateBody.trim().startsWith('{') ? 'json' : 'yaml'}
            filename='template.yaml'
            readOnly
            height={300}
          />
        </FormSection>
      )}
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default StackParametersForm;
