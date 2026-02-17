import React from 'react';
import { Stack } from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const ServiceScalingForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const { values, setField, dirty, reset } = useFormState({
    DesiredCount: data.DesiredCount ?? 0,
    LaunchType: data.LaunchType ?? 'FARGATE',
    SchedulingStrategy: data.SchedulingStrategy ?? 'REPLICA',
    EnableExecuteCommand: data.EnableExecuteCommand ?? false,
    EnableECSManagedTags: data.EnableECSManagedTags ?? false,
    HealthCheckGracePeriodSeconds: data.HealthCheckGracePeriodSeconds ?? 0,
    ForceNewDeployment: false,
    MinimumHealthyPercent: data.DeploymentConfiguration?.MinimumHealthyPercent ?? 100,
    MaximumPercent: data.DeploymentConfiguration?.MaximumPercent ?? 200,
  });

  const handleSave = () => {
    onSave(values);
  };

  const scalingFields: FormField[] = [
    { key: 'DesiredCount', label: 'Desired Count', type: 'number', value: values.DesiredCount, min: 0, max: 10000 },
    { key: 'LaunchType', label: 'Launch Type', type: 'readonly', value: values.LaunchType },
    { key: 'SchedulingStrategy', label: 'Scheduling Strategy', type: 'readonly', value: values.SchedulingStrategy },
    { key: 'ForceNewDeployment', label: 'Force New Deployment', type: 'switch', value: values.ForceNewDeployment },
  ];

  const deploymentFields: FormField[] = [
    { key: 'MinimumHealthyPercent', label: 'Min Healthy %', type: 'number', value: values.MinimumHealthyPercent, min: 0, max: 200, step: 25 },
    { key: 'MaximumPercent', label: 'Max %', type: 'number', value: values.MaximumPercent, min: 100, max: 400, step: 25 },
    { key: 'HealthCheckGracePeriodSeconds', label: 'Health Check Grace (s)', type: 'number', value: values.HealthCheckGracePeriodSeconds, min: 0, max: 7200 },
  ];

  const featureFields: FormField[] = [
    { key: 'EnableExecuteCommand', label: 'Execute Command', type: 'switch', value: values.EnableExecuteCommand },
    { key: 'EnableECSManagedTags', label: 'ECS Managed Tags', type: 'switch', value: values.EnableECSManagedTags },
  ];

  return (
    <Stack spacing={1}>
      <FormCard
        title='Service Configuration'
        fields={scalingFields}
        onChange={setField}
        onSave={handleSave}
        onReset={reset}
        dirty={dirty}
        saving={saving}
        compact
      />
      <FormCard
        title='Deployment Configuration'
        fields={deploymentFields}
        onChange={setField}
        compact
      />
      <FormCard
        title='Features'
        fields={featureFields}
        onChange={setField}
        compact
      />
    </Stack>
  );
};

export default ServiceScalingForm;
