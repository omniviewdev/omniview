import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { ColorPicker, TimeRangePicker } from '../../inputs';
import type { TimeRange } from '../../inputs';

export default function PickersPage() {
  const [color, setColor] = useState('#3b82f6');
  const [timeRange, setTimeRange] = useState<TimeRange>({
    from: new Date(Date.now() - 60 * 60 * 1000),
    to: new Date(),
  });

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Pickers
      </Typography>

      {/* ColorPicker */}
      <Section
        title="ColorPicker"
        description="Color palette grid with optional custom hex input."
      >
        <ImportStatement code="import { ColorPicker } from '@omniviewdev/ui/inputs';" />

        <Example title="Basic">
          <ColorPicker value={color} onChange={setColor} />
          <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', mt: 1, display: 'block' }}>
            Selected: {color}
          </Typography>
        </Example>

        <Example title="Without Custom Input">
          <ColorPicker value={color} onChange={setColor} allowCustom={false} />
        </Example>

        <Example title="Custom Presets">
          <ColorPicker
            value={color}
            onChange={setColor}
            presets={['#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9']}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'Selected color (hex)' },
            { name: 'onChange', type: '(color: string) => void', description: 'Change handler' },
            { name: 'presets', type: 'string[]', description: 'Color preset palette' },
            { name: 'allowCustom', type: 'boolean', default: 'true', description: 'Show custom hex input' },
          ]}
        />
      </Section>

      {/* TimeRangePicker */}
      <Section
        title="TimeRangePicker"
        description="Time range picker for logs and metrics with preset durations and optional custom range."
      >
        <ImportStatement code="import { TimeRangePicker } from '@omniviewdev/ui/inputs';" />

        <Example title="Default Presets">
          <TimeRangePicker value={timeRange} onChange={setTimeRange} />
          <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', mt: 1, display: 'block' }}>
            Range: {timeRange.from.toLocaleString()} — {timeRange.to.toLocaleString()}
          </Typography>
        </Example>

        <Example title="Without Custom Range">
          <TimeRangePicker value={timeRange} onChange={setTimeRange} customRange={false} />
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'TimeRange', description: '{ from: Date, to: Date }' },
            { name: 'onChange', type: '(range: TimeRange) => void', description: 'Change handler' },
            { name: 'presets', type: 'TimeRangePreset[]', description: 'Preset duration buttons' },
            { name: 'customRange', type: 'boolean', default: 'true', description: 'Show custom range popover' },
          ]}
        />
      </Section>
    </Box>
  );
}
