import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
} from '@mui/joy';
import FormCard, { type FormField } from '../../../shared/forms/FormCard';
import KeyValueEditor from '../../../shared/forms/KeyValueEditor';
import ArrayChipEditor from '../../../shared/forms/ArrayChipEditor';
import TagEditor, { type Tag } from '../../../shared/forms/TagEditor';
import useFormState from '../../../shared/forms/useFormState';

type Props = {
  data: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
  saving?: boolean;
};

const NETWORK_MODE_OPTIONS = [
  { label: 'awsvpc', value: 'awsvpc' },
  { label: 'bridge', value: 'bridge' },
  { label: 'host', value: 'host' },
  { label: 'none', value: 'none' },
];

// ── Container Definition Card ─────────────────────────────────────────────────

const ContainerCard: React.FC<{ container: Record<string, any>; index: number }> = ({ container, index }) => {
  const envVars: Record<string, string> = {};
  if (Array.isArray(container.Environment)) {
    for (const env of container.Environment) {
      if (env.Name) envVars[env.Name] = env.Value || '';
    }
  }

  const portMappings = (container.PortMappings || []).map(
    (pm: any) => `${pm.ContainerPort}${pm.HostPort && pm.HostPort !== pm.ContainerPort ? `:${pm.HostPort}` : ''}/${pm.Protocol || 'tcp'}`
  );

  const mountPoints = (container.MountPoints || []).map(
    (mp: any) => `${mp.SourceVolume} → ${mp.ContainerPath}${mp.ReadOnly ? ' (ro)' : ''}`
  );

  const fields: FormField[] = [
    { key: 'Name', label: 'Container Name', type: 'readonly', value: container.Name },
    { key: 'Image', label: 'Image', type: 'readonly', value: container.Image },
    { key: 'Essential', label: 'Essential', type: 'readonly', value: container.Essential },
    { key: 'Cpu', label: 'CPU Units', type: 'readonly', value: container.Cpu },
    { key: 'Memory', label: 'Memory (MB)', type: 'readonly', value: container.Memory },
    { key: 'MemoryReservation', label: 'Memory Reservation (MB)', type: 'readonly', value: container.MemoryReservation },
    { key: 'EntryPoint', label: 'Entry Point', type: 'readonly', value: Array.isArray(container.EntryPoint) ? container.EntryPoint.join(' ') : container.EntryPoint },
    { key: 'Command', label: 'Command', type: 'readonly', value: Array.isArray(container.Command) ? container.Command.join(' ') : container.Command },
    { key: 'WorkingDirectory', label: 'Working Directory', type: 'readonly', value: container.WorkingDirectory },
  ];

  const logConfig = container.LogConfiguration;

  return (
    <Card
      sx={{ '--Card-padding': '0px', '--Card-gap': '0px', borderRadius: 'sm', gap: '0px' }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center'>
          <Typography level='title-sm'>Container #{index + 1}: {container.Name}</Typography>
          {container.Essential && (
            <Typography level='body-xs' color='primary' fontWeight={700}>Essential</Typography>
          )}
        </Stack>
      </Box>
      <Divider />
      <CardContent sx={{ p: 0, backgroundColor: 'background.level1', borderBottomRightRadius: 6, borderBottomLeftRadius: 6 }}>
        <Stack spacing={1} sx={{ p: 1.5 }}>
          <FormCard
            title='Configuration'
            fields={fields}
            onChange={() => {}}
            compact
          />
          {portMappings.length > 0 && (
            <ArrayChipEditor
              title='Port Mappings'
              items={portMappings}
              onChange={() => {}}
              readOnly
              chipColor='primary'
            />
          )}
          {Object.keys(envVars).length > 0 && (
            <KeyValueEditor
              title='Environment Variables'
              entries={envVars}
              onChange={() => {}}
              readOnly
              keyLabel='Name'
              valueLabel='Value'
            />
          )}
          {mountPoints.length > 0 && (
            <ArrayChipEditor
              title='Mount Points'
              items={mountPoints}
              onChange={() => {}}
              readOnly
              chipColor='neutral'
            />
          )}
          {logConfig && (
            <FormCard
              title='Logging'
              fields={[
                { key: 'logDriver', label: 'Log Driver', type: 'readonly' as const, value: logConfig.LogDriver },
                ...Object.entries(logConfig.Options || {}).map(([k, v]) => ({
                  key: k,
                  label: k,
                  type: 'readonly' as const,
                  value: String(v),
                })),
              ]}
              onChange={() => {}}
              compact
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const TaskDefinitionForm: React.FC<Props> = ({ data, onSave, saving }) => {
  const rawTags: Tag[] = Array.isArray(data.Tags)
    ? data.Tags.map((t: any) => ({ Key: t.Key || '', Value: t.Value || '' }))
    : [];

  const { values, setField, dirty, reset } = useFormState({
    Cpu: data.Cpu ?? '',
    Memory: data.Memory ?? '',
    NetworkMode: data.NetworkMode ?? 'awsvpc',
  });

  const [tags, setTags] = React.useState<Tag[]>(rawTags);
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(rawTags);
  const allDirty = dirty || tagsDirty;

  const handleSave = () => {
    onSave({
      ...values,
      Tags: tags.map((t) => ({ Key: t.Key, Value: t.Value })),
    });
  };

  const handleReset = () => {
    reset();
    setTags(rawTags);
  };

  const infoFields: FormField[] = [
    { key: 'Family', label: 'Family', type: 'readonly', value: data.Family },
    { key: 'Revision', label: 'Revision', type: 'readonly', value: data.Revision },
    { key: 'TaskDefinitionArn', label: 'ARN', type: 'readonly', value: data.TaskDefinitionArn },
    { key: 'Status', label: 'Status', type: 'readonly', value: data.Status, color: data.Status === 'ACTIVE' ? 'success' : 'danger' },
    { key: 'TaskRoleArn', label: 'Task Role', type: 'readonly', value: data.TaskRoleArn },
    { key: 'ExecutionRoleArn', label: 'Execution Role', type: 'readonly', value: data.ExecutionRoleArn },
  ];

  const computeFields: FormField[] = [
    { key: 'Cpu', label: 'CPU', type: 'text', value: values.Cpu, placeholder: '256' },
    { key: 'Memory', label: 'Memory', type: 'text', value: values.Memory, placeholder: '512' },
    { key: 'NetworkMode', label: 'Network Mode', type: 'select', value: values.NetworkMode, options: NETWORK_MODE_OPTIONS },
  ];

  const compatibilities = data.RequiresCompatibilities || data.Compatibilities || [];
  const volumes = (data.Volumes || []).map(
    (v: any) => v.Name || 'unnamed'
  );

  const containers = data.ContainerDefinitions || [];

  return (
    <Stack spacing={1}>
      <FormCard
        title='Task Definition'
        fields={infoFields}
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
      <ArrayChipEditor
        title='Compatibilities'
        items={compatibilities}
        onChange={() => {}}
        readOnly
        chipColor='primary'
      />
      {volumes.length > 0 && (
        <ArrayChipEditor
          title='Volumes'
          items={volumes}
          onChange={() => {}}
          readOnly
          chipColor='neutral'
        />
      )}
      {/* Container definitions */}
      {containers.map((c: any, i: number) => (
        <ContainerCard key={i} container={c} index={i} />
      ))}
      <TagEditor tags={tags} onChange={setTags} />
    </Stack>
  );
};

export default TaskDefinitionForm;
