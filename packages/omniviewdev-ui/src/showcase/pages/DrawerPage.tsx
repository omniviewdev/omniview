import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Drawer } from '../../overlays';
import { Button } from '../../buttons';

export default function DrawerPage() {
  const [rightOpen, setRightOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [resizableOpen, setResizableOpen] = useState(false);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Drawer
      </Typography>

      <Section
        title="Drawer"
        description="Slide-out panel with optional title, resize handle, and persistent mode."
      >
        <ImportStatement code="import { Drawer } from '@omniviewdev/ui/overlays';" />

        <Example title="Anchors">
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button emphasis="outline" color="primary" onClick={() => setRightOpen(true)}>
              Right Drawer
            </Button>
            <Button emphasis="outline" color="primary" onClick={() => setLeftOpen(true)}>
              Left Drawer
            </Button>
            <Button emphasis="outline" color="primary" onClick={() => setBottomOpen(true)}>
              Bottom Drawer
            </Button>
          </Box>

          <Drawer open={rightOpen} onClose={() => setRightOpen(false)} title="Right Drawer" anchor="right">
            <Typography sx={{ color: 'var(--ov-fg-default)' }}>
              Content for the right drawer panel.
            </Typography>
          </Drawer>

          <Drawer open={leftOpen} onClose={() => setLeftOpen(false)} title="Left Drawer" anchor="left">
            <Typography sx={{ color: 'var(--ov-fg-default)' }}>
              Content for the left drawer panel.
            </Typography>
          </Drawer>

          <Drawer open={bottomOpen} onClose={() => setBottomOpen(false)} title="Bottom Drawer" anchor="bottom" size={300}>
            <Typography sx={{ color: 'var(--ov-fg-default)' }}>
              Content for the bottom drawer panel.
            </Typography>
          </Drawer>
        </Example>

        <Example title="Resizable" description="Drag the edge to resize.">
          <Button emphasis="outline" color="accent" onClick={() => setResizableOpen(true)}>
            Open Resizable Drawer
          </Button>
          <Drawer
            open={resizableOpen}
            onClose={() => setResizableOpen(false)}
            title="Resizable Drawer"
            resizable
            size={400}
          >
            <Typography sx={{ color: 'var(--ov-fg-default)' }}>
              Drag the left edge to resize this drawer.
            </Typography>
          </Drawer>
        </Example>

        <PropsTable
          props={[
            { name: 'open', type: 'boolean', description: 'Whether the drawer is visible' },
            { name: 'onClose', type: '() => void', description: 'Close handler' },
            { name: 'anchor', type: "'left' | 'right' | 'bottom'", default: "'right'", description: 'Side the drawer slides from' },
            { name: 'size', type: 'number | string', default: '360', description: 'Width (horizontal) or height (bottom)' },
            { name: 'resizable', type: 'boolean', default: 'false', description: 'Show drag handle for resizing' },
            { name: 'persistent', type: 'boolean', default: 'false', description: 'Keep mounted when closed' },
            { name: 'title', type: 'string', description: 'Header title with close button' },
            { name: 'children', type: 'ReactNode', description: 'Drawer content' },
          ]}
        />
      </Section>
    </Box>
  );
}
