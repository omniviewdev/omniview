import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';
import SizePicker from '../helpers/SizePicker';

import { TextField, TextArea } from '@omniviewdev/ui/inputs';
import type { ComponentSize } from '@omniviewdev/ui/types';

export default function TextFieldPage() {
  const [size, setSize] = useState<ComponentSize>('md');
  const [basic, setBasic] = useState('');
  const [mono, setMono] = useState('kubectl get pods -n default');
  const [debounced, setDebounced] = useState('');
  const [area, setArea] = useState('');
  const [counted, setCounted] = useState('Hello world');

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        TextField & TextArea
      </Typography>

      <Section title="TextField" description="Wrapped MUI TextField with our size/color API, monospace and debounce support.">
        <ImportStatement code="import { TextField } from '@omniviewdev/ui/inputs';" />
        <SizePicker value={size} onChange={setSize} />

        <Example title="Basic">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <TextField value={basic} onChange={setBasic} placeholder="Enter text..." label="Name" size={size} fullWidth />
            <TextField value="" onChange={() => {}} placeholder="Disabled" disabled size={size} fullWidth />
            <TextField value="" onChange={() => {}} error="This field is required" label="Required" size={size} fullWidth />
          </Box>
        </Example>

        <Example title="Monospace" description="For code / command inputs.">
          <TextField value={mono} onChange={setMono} monospace size={size} fullWidth sx={{ maxWidth: 400 }} />
        </Example>

        <Example title="Debounced" description="Fires onChange only after typing stops.">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 400 }}>
            <TextField value={debounced} onChange={setDebounced} debounced debounceMs={500} placeholder="Type and wait..." size={size} fullWidth />
            <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', fontFamily: 'var(--ov-font-mono)' }}>
              Value: {debounced || '(empty)'}
            </Typography>
          </Box>
        </Example>

        <Example title="With adornments">
          <TextField value="" onChange={() => {}} placeholder="Search..." startAdornment={<SearchIcon fontSize="small" />} size={size} sx={{ maxWidth: 400 }} fullWidth />
        </Example>

        <PropsTable props={[
          { name: 'value', type: 'string', description: 'Current value.' },
          { name: 'onChange', type: '(value: string) => void', description: 'Change handler.' },
          { name: 'size', type: 'ComponentSize', default: '"md"', description: 'xs | sm | md | lg | xl.' },
          { name: 'monospace', type: 'boolean', default: 'false', description: 'Use monospace font.' },
          { name: 'debounced', type: 'boolean', default: 'false', description: 'Enable debounce.' },
          { name: 'debounceMs', type: 'number', default: '300', description: 'Debounce delay in ms.' },
          { name: 'readOnly', type: 'boolean', default: 'false', description: 'Read-only mode.' },
          { name: 'error', type: 'boolean | string', description: 'Error state or message.' },
        ]} />
      </Section>

      <Section title="TextArea" description="Multi-line text input with auto-resize and character counting.">
        <ImportStatement code="import { TextArea } from '@omniviewdev/ui/inputs';" />
        <SizePicker value={size} onChange={setSize} />

        <Example title="Basic">
          <TextArea value={area} onChange={setArea} placeholder="Enter description..." size={size} fullWidth sx={{ maxWidth: 400 }} />
        </Example>

        <Example title="With character count" description="Shows character count with optional max length.">
          <TextArea value={counted} onChange={setCounted} showCount maxLength={200} size={size} fullWidth sx={{ maxWidth: 400 }} />
        </Example>

        <PropsTable props={[
          { name: 'value', type: 'string', description: 'Current value.' },
          { name: 'onChange', type: '(value: string) => void', description: 'Change handler.' },
          { name: 'size', type: 'ComponentSize', default: '"md"', description: 'xs | sm | md | lg | xl.' },
          { name: 'autosize', type: 'boolean', default: 'false', description: 'Auto-resize with content.' },
          { name: 'maxLength', type: 'number', description: 'Maximum character length.' },
          { name: 'showCount', type: 'boolean', default: 'false', description: 'Show character count.' },
          { name: 'rows', type: 'number', default: '3', description: 'Number of visible rows.' },
        ]} />
      </Section>
    </Box>
  );
}
