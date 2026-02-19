import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import SizePicker from '../helpers/SizePicker';

import { Checkbox, RadioGroup, Switch, Slider, FormField, FormSection, TextField } from '../../inputs';
import type { ComponentSize } from '../../types';

export default function FormPage() {
  const [size, setSize] = useState<ComponentSize>('md');
  const [checked, setChecked] = useState(false);
  const [indeterminate, setIndeterminate] = useState(true);
  const [radio, setRadio] = useState('option1');
  const [switchVal, setSwitchVal] = useState(true);
  const [slider, setSlider] = useState(30);
  const [range, setRange] = useState<number[]>([20, 80]);
  const [name, setName] = useState('');

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Form Controls
      </Typography>

      <Section title="Checkbox">
        <ImportStatement code="import { Checkbox } from '@omniviewdev/ui/inputs';" />
        <Example title="Basic">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Checkbox checked={checked} onChange={setChecked} label="Accept terms" />
            <Checkbox checked={indeterminate} onChange={() => setIndeterminate(!indeterminate)} indeterminate={indeterminate} label="Select all (indeterminate)" />
            <Checkbox checked={false} onChange={() => {}} label="Disabled" disabled />
          </Box>
        </Example>
      </Section>

      <Section title="RadioGroup">
        <ImportStatement code="import { RadioGroup } from '@omniviewdev/ui/inputs';" />
        <Example title="Column layout">
          <RadioGroup
            value={radio}
            onChange={setRadio}
            label="Restart policy"
            options={[
              { value: 'option1', label: 'Always', description: 'Always restart the container' },
              { value: 'option2', label: 'OnFailure', description: 'Only restart on failure' },
              { value: 'option3', label: 'Never' },
            ]}
          />
        </Example>
        <Example title="Row layout">
          <RadioGroup
            value={radio}
            onChange={setRadio}
            layout="row"
            options={[
              { value: 'option1', label: 'Always' },
              { value: 'option2', label: 'OnFailure' },
              { value: 'option3', label: 'Never' },
            ]}
          />
        </Example>
      </Section>

      <Section title="Switch">
        <ImportStatement code="import { Switch } from '@omniviewdev/ui/inputs';" />
        <SizePicker value={size} onChange={setSize} />

        <Example title="Basic">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Switch checked={switchVal} onChange={setSwitchVal} label="Enable notifications" size={size} />
            <Switch checked={false} onChange={() => {}} label="Disabled" disabled size={size} />
            <Switch checked={true} onChange={() => {}} label="Label on start" labelPlacement="start" size={size} />
          </Box>
        </Example>

        <Example title="All sizes">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
              <Switch key={s} checked={true} onChange={() => {}} label={s} size={s} />
            ))}
          </Box>
        </Example>
      </Section>

      <Section title="Slider">
        <ImportStatement code="import { Slider } from '@omniviewdev/ui/inputs';" />
        <Example title="Single value">
          <Box sx={{ maxWidth: 400 }}>
            <Slider value={slider} onChange={(v) => setSlider(v as number)} showValue />
          </Box>
        </Example>
        <Example title="Range" description="Two-thumb slider for selecting a range.">
          <Box sx={{ maxWidth: 400 }}>
            <Slider value={range} onChange={(v) => setRange(v as number[])} showValue />
          </Box>
        </Example>
        <Example title="With marks">
          <Box sx={{ maxWidth: 400 }}>
            <Slider
              value={50}
              onChange={() => {}}
              marks={[
                { value: 0, label: '0%' },
                { value: 25, label: '25%' },
                { value: 50, label: '50%' },
                { value: 75, label: '75%' },
                { value: 100, label: '100%' },
              ]}
            />
          </Box>
        </Example>
      </Section>

      <Section title="FormField & FormSection" description="Layout primitives for building consistent forms.">
        <ImportStatement code="import { FormField, FormSection } from '@omniviewdev/ui/inputs';" />

        <Example title="Vertical layout (default)">
          <Box sx={{ maxWidth: 400 }}>
            <FormField label="Pod name" required helperText="Must be unique within namespace.">
              <TextField value={name} onChange={setName} placeholder="my-pod" fullWidth />
            </FormField>
            <FormField label="Description" helperText="Optional description.">
              <TextField value="" onChange={() => {}} placeholder="..." fullWidth />
            </FormField>
          </Box>
        </Example>

        <Example title="Horizontal layout">
          <Box sx={{ maxWidth: 500 }}>
            <FormField label="Replicas" layout="horizontal">
              <TextField value="3" onChange={() => {}} fullWidth />
            </FormField>
            <FormField label="Image" layout="horizontal" error="Image not found">
              <TextField value="nginx:latest" onChange={() => {}} fullWidth />
            </FormField>
          </Box>
        </Example>

        <Example title="FormSection">
          <FormSection title="Basic Configuration" description="Configure the core settings for your deployment.">
            <FormField label="Name" required>
              <TextField value="" onChange={() => {}} placeholder="deployment-name" fullWidth />
            </FormField>
          </FormSection>
          <FormSection title="Advanced" collapsible defaultCollapsed description="Additional options for fine-tuning.">
            <FormField label="Timeout">
              <TextField value="30" onChange={() => {}} fullWidth />
            </FormField>
          </FormSection>
        </Example>
      </Section>
    </Box>
  );
}
