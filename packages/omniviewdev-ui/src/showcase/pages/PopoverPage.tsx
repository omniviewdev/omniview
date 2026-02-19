import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Popover } from '../../overlays';
import { Button } from '../../buttons';

export default function PopoverPage() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [anchorEl2, setAnchorEl2] = useState<HTMLElement | null>(null);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Popover
      </Typography>

      <Section
        title="Popover"
        description="Positioned overlay anchored to an element. Wraps MUI Popover with consistent styling."
      >
        <ImportStatement code="import { Popover } from '@omniviewdev/ui/overlays';" />

        <Example title="Basic Popover">
          <Button
            emphasis="outline"
            color="primary"
            size="sm"
            onClick={(e) => setAnchorEl(e.currentTarget as HTMLElement)}
          >
            Open Popover
          </Button>
          <Popover
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
            anchorEl={anchorEl}
            width={280}
          >
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'var(--ov-fg-base)' }}>
                Popover Content
              </Typography>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                This popover has consistent border and background styling using design tokens.
              </Typography>
            </Box>
          </Popover>
        </Example>

        <Example title="Placement" description="Control placement relative to the anchor.">
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {(['top', 'bottom', 'left', 'right'] as const).map((p) => (
              <Button
                key={p}
                emphasis="ghost"
                color="neutral"
                size="sm"
                onClick={(e) => {
                  setAnchorEl2(e.currentTarget as HTMLElement);
                }}
              >
                {p}
              </Button>
            ))}
          </Box>
          <Popover
            open={Boolean(anchorEl2)}
            onClose={() => setAnchorEl2(null)}
            anchorEl={anchorEl2}
            width={200}
          >
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                Popover content
              </Typography>
            </Box>
          </Popover>
        </Example>

        <PropsTable
          props={[
            { name: 'open', type: 'boolean', description: 'Whether the popover is visible' },
            { name: 'onClose', type: '() => void', description: 'Close handler' },
            { name: 'anchorEl', type: 'HTMLElement | null', description: 'Element to anchor to' },
            { name: 'children', type: 'ReactNode', description: 'Popover content' },
            { name: 'width', type: 'number | string', description: 'Popover width' },
            { name: 'placement', type: "'top' | 'bottom' | 'left' | 'right'", default: "'bottom'", description: 'Position relative to anchor' },
          ]}
        />
      </Section>
    </Box>
  );
}
