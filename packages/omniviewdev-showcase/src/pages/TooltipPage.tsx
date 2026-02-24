import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Tooltip } from '@omniviewdev/ui/overlays';
import { Button } from '@omniviewdev/ui/buttons';

export default function TooltipPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Tooltip
      </Typography>

      <Section
        title="Tooltip"
        description="Informational tooltip with default, rich, and code variants."
      >
        <ImportStatement code="import { Tooltip } from '@omniviewdev/ui/overlays';" />

        <Example title="Default Variant" description="Simple text tooltip with arrow.">
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Tooltip title="Top tooltip" placement="top">
              <Button emphasis="outline" color="neutral" size="sm">Top</Button>
            </Tooltip>
            <Tooltip title="Bottom tooltip" placement="bottom">
              <Button emphasis="outline" color="neutral" size="sm">Bottom</Button>
            </Tooltip>
            <Tooltip title="Left tooltip" placement="left">
              <Button emphasis="outline" color="neutral" size="sm">Left</Button>
            </Tooltip>
            <Tooltip title="Right tooltip" placement="right">
              <Button emphasis="outline" color="neutral" size="sm">Right</Button>
            </Tooltip>
          </Box>
        </Example>

        <Example title="Rich Variant" description="Supports ReactNode content with padding.">
          <Tooltip
            variant="rich"
            title={
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Pod Details</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Running on node-1 since 2h ago. CPU: 250m, Memory: 128Mi.
                </Typography>
              </Box>
            }
          >
            <Button emphasis="soft" color="info" size="sm">Hover for details</Button>
          </Tooltip>
        </Example>

        <Example title="Code Variant" description="Mono font with inset background for code snippets.">
          <Tooltip variant="code" title="kubectl get pods -n default">
            <Button emphasis="ghost" color="neutral" size="sm">Hover for command</Button>
          </Tooltip>
        </Example>

        <Example title="With Delay" description="Enter delay prevents premature display.">
          <Tooltip title="Delayed tooltip" delay={500}>
            <Button emphasis="outline" color="primary" size="sm">500ms delay</Button>
          </Tooltip>
        </Example>

        <PropsTable
          props={[
            { name: 'title', type: 'ReactNode', description: 'Tooltip content' },
            { name: 'variant', type: "'default' | 'rich' | 'code'", default: "'default'", description: 'Visual style' },
            { name: 'placement', type: "'top' | 'bottom' | 'left' | 'right' | ...", default: "'top'", description: 'Position relative to anchor' },
            { name: 'delay', type: 'number', description: 'Enter delay in ms' },
            { name: 'children', type: 'ReactElement', description: 'Element to attach tooltip to' },
          ]}
        />
      </Section>
    </Box>
  );
}
