import React from 'react';
import { Stack } from '@omniviewdev/ui/layout';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import KeyValueEditor from '../../../shared/forms/KeyValueEditor';
import ArrayChipEditor from '../../../shared/forms/ArrayChipEditor';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const RUNTIME_OPTIONS = [
  { label: 'Node.js 20.x', value: 'nodejs20.x' },
  { label: 'Node.js 18.x', value: 'nodejs18.x' },
  { label: 'Python 3.12', value: 'python3.12' },
  { label: 'Python 3.11', value: 'python3.11' },
  { label: 'Python 3.10', value: 'python3.10' },
  { label: 'Python 3.9', value: 'python3.9' },
  { label: 'Java 21', value: 'java21' },
  { label: 'Java 17', value: 'java17' },
  { label: 'Java 11', value: 'java11' },
  { label: '.NET 8', value: 'dotnet8' },
  { label: '.NET 6', value: 'dotnet6' },
  { label: 'Go 1.x', value: 'provided.al2023' },
  { label: 'Ruby 3.3', value: 'ruby3.3' },
  { label: 'Ruby 3.2', value: 'ruby3.2' },
  { label: 'Custom (AL2023)', value: 'provided.al2023' },
  { label: 'Custom (AL2)', value: 'provided.al2' },
];

const FunctionConfigForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const envVars: Record<string, string> = data.Environment?.Variables || {};

  const { values, setField, dirty, reset } = useFormState({
    Handler: data.Handler ?? '',
    Runtime: data.Runtime ?? '',
    MemorySize: data.MemorySize ?? 128,
    Timeout: data.Timeout ?? 3,
    Description: data.Description ?? '',
    EphemeralStorageSize: data.EphemeralStorage?.Size ?? 512,
  });

  const [envState, setEnvState] = React.useState<Record<string, string>>(envVars);
  const [layers, setLayers] = React.useState<string[]>(
    (data.Layers || []).map((l: any) => l.Arn || l)
  );

  const envDirty = JSON.stringify(envState) !== JSON.stringify(envVars);
  const layersDirty = JSON.stringify(layers) !== JSON.stringify((data.Layers || []).map((l: any) => l.Arn || l));
  const allDirty = dirty || envDirty || layersDirty;

  const handleSave = () => {
    onSave({
      ...values,
      Environment: { Variables: envState },
      Layers: layers,
    });
  };

  const handleReset = () => {
    reset();
    setEnvState(envVars);
    setLayers((data.Layers || []).map((l: any) => l.Arn || l));
  };

  const generalFields: FormField[] = [
    { key: 'FunctionName', label: 'Function Name', type: 'readonly', value: data.FunctionName },
    { key: 'FunctionArn', label: 'ARN', type: 'readonly', value: data.FunctionArn },
    { key: 'Description', label: 'Description', type: 'text', value: values.Description, placeholder: 'Function description' },
    { key: 'Runtime', label: 'Runtime', type: 'select', value: values.Runtime, options: RUNTIME_OPTIONS },
    { key: 'Handler', label: 'Handler', type: 'text', value: values.Handler, placeholder: 'index.handler' },
    { key: 'Architecture', label: 'Architecture', type: 'readonly', value: data.Architectures?.[0] },
  ];

  const computeFields: FormField[] = [
    { key: 'MemorySize', label: 'Memory (MB)', type: 'number', value: values.MemorySize, min: 128, max: 10240, step: 64 },
    { key: 'Timeout', label: 'Timeout (s)', type: 'number', value: values.Timeout, min: 1, max: 900 },
    { key: 'EphemeralStorageSize', label: 'Ephemeral Storage (MB)', type: 'number', value: values.EphemeralStorageSize, min: 512, max: 10240, step: 1 },
  ];

  const infoFields: FormField[] = [
    { key: 'CodeSize', label: 'Code Size', type: 'readonly', value: data.CodeSize ? `${(data.CodeSize / 1024 / 1024).toFixed(2)} MB` : undefined },
    { key: 'LastModified', label: 'Last Modified', type: 'readonly', value: data.LastModified },
    { key: 'Version', label: 'Version', type: 'readonly', value: data.Version },
    { key: 'State', label: 'State', type: 'readonly', value: data.State, color: data.State === 'Active' ? 'success' : data.State === 'Failed' ? 'danger' : 'neutral' },
    { key: 'PackageType', label: 'Package Type', type: 'readonly', value: data.PackageType },
    { key: 'Role', label: 'Execution Role', type: 'readonly', value: data.Role },
  ];

  return (
    <Stack spacing={1}>
      <FormCard
        title='General Configuration'
        fields={generalFields}
        onChange={setField}
        onSave={handleSave}
        onReset={handleReset}
        dirty={allDirty}
        saving={saving}
        compact
      />
      <FormCard
        title='Compute'
        fields={computeFields}
        onChange={setField}
        compact
      />
      <KeyValueEditor
        title='Environment Variables'
        entries={envState}
        onChange={setEnvState}
        keyLabel='Variable'
        valueLabel='Value'
        keyPlaceholder='MY_VAR'
        valuePlaceholder='value'
      />
      <ArrayChipEditor
        title='Layers'
        items={layers}
        onChange={setLayers}
        placeholder='arn:aws:lambda:...'
        chipColor='primary'
      />
      <FormCard
        title='Function Info'
        fields={infoFields}
        onChange={() => {}}
        compact
      />
    </Stack>
  );
};

export default FunctionConfigForm;
