import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { ClipboardText, OverflowText, InlineEdit, HotkeyHint } from '@omniviewdev/ui';

export default function UtilityComponentsPage() {
  const [editValue, setEditValue] = useState('nginx-abc123');

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Utility Components
      </Typography>

      {/* ClipboardText */}
      <Section
        title="ClipboardText"
        description="Truncated text with copy icon on hover."
      >
        <ImportStatement code="import { ClipboardText } from '@omniviewdev/ui';" />

        <Example title="Basic">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <ClipboardText value="a1b2c3d4-e5f6-7890-abcd-ef1234567890" maxWidth={300} />
            <ClipboardText value="short-value" />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'Text to display and copy' },
            { name: 'truncate', type: 'boolean', default: 'true', description: 'Truncate with ellipsis' },
            { name: 'maxWidth', type: 'number | string', description: 'Maximum width before truncation' },
          ]}
        />
      </Section>

      {/* OverflowText */}
      <Section
        title="OverflowText"
        description="Shows tooltip only when text overflows its container."
      >
        <ImportStatement code="import { OverflowText } from '@omniviewdev/ui';" />

        <Example title="Overflow Detection">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <OverflowText maxWidth={200}>
              This is a very long text that will overflow and show a tooltip on hover
            </OverflowText>
            <OverflowText maxWidth={400}>Short text — no tooltip</OverflowText>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'children', type: 'string', description: 'Text content' },
            { name: 'maxWidth', type: 'number | string', description: 'Maximum width' },
            { name: 'copyOnClick', type: 'boolean', default: 'false', description: 'Copy text on click' },
          ]}
        />
      </Section>

      {/* InlineEdit */}
      <Section
        title="InlineEdit"
        description="Click to switch from display to edit mode. Blur or Enter saves, Escape cancels."
      >
        <ImportStatement code="import { InlineEdit } from '@omniviewdev/ui';" />

        <Example title="Basic">
          <InlineEdit value={editValue} onSave={setEditValue} />
          <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', mt: 0.5, display: 'block' }}>
            Current value: {editValue}
          </Typography>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'Display value' },
            { name: 'onSave', type: '(value: string) => void', description: 'Save callback' },
            { name: 'placeholder', type: 'string', default: "'Click to edit'", description: 'Placeholder when empty' },
            { name: 'size', type: 'ComponentSize', default: "'sm'", description: 'Font size' },
          ]}
        />
      </Section>

      {/* HotkeyHint */}
      <Section
        title="HotkeyHint"
        description="Renders keyboard shortcut badges with platform-aware symbols."
      >
        <ImportStatement code="import { HotkeyHint } from '@omniviewdev/ui';" />

        <Example title="Common Shortcuts">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)', width: 120 }}>Save</Typography>
              <HotkeyHint keys={['Meta', 'S']} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)', width: 120 }}>Command Palette</Typography>
              <HotkeyHint keys={['Meta', 'Shift', 'P']} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)', width: 120 }}>Navigate</Typography>
              <HotkeyHint keys={['ArrowUp']} />
              <HotkeyHint keys={['ArrowDown']} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)', width: 120 }}>Confirm</Typography>
              <HotkeyHint keys={['Enter']} />
            </Box>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'keys', type: 'string[]', description: 'Array of key names (e.g., ["Meta", "S"])' },
          ]}
        />
      </Section>
    </Box>
  );
}
