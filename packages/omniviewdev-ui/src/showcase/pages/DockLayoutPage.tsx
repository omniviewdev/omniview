import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { DockLayout } from '../../layout';
import type { DockNode } from '../../layout';

function PanelContent({ id, color }: { id: string; color: string }) {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: color,
        borderRadius: '4px',
        p: 2,
      }}
    >
      <Typography sx={{ fontSize: 'var(--ov-text-sm)', fontWeight: 500, color: 'var(--ov-fg-base)' }}>
        {id}
      </Typography>
    </Box>
  );
}

const simpleLayout: DockNode = {
  type: 'horizontal',
  children: [
    { type: 'leaf', id: 'sidebar', minSize: 120 },
    { type: 'leaf', id: 'editor', minSize: 200 },
    { type: 'leaf', id: 'panel', minSize: 120 },
  ],
  sizes: [25, 50, 25],
};

const nestedLayout: DockNode = {
  type: 'horizontal',
  children: [
    { type: 'leaf', id: 'explorer', minSize: 150 },
    {
      type: 'vertical',
      children: [
        { type: 'leaf', id: 'editor', minSize: 100 },
        { type: 'leaf', id: 'terminal', minSize: 80 },
      ],
      sizes: [70, 30],
    },
    { type: 'leaf', id: 'properties', minSize: 150 },
  ],
  sizes: [20, 60, 20],
};

const panelColors: Record<string, string> = {
  sidebar: 'var(--ov-bg-surface-inset)',
  editor: 'var(--ov-bg-surface)',
  panel: 'var(--ov-bg-surface-inset)',
  explorer: 'var(--ov-bg-surface-inset)',
  terminal: 'var(--ov-bg-surface-inset)',
  properties: 'var(--ov-bg-surface-inset)',
};

export default function DockLayoutPage() {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Dock Layout
      </Typography>

      <Section title="DockLayout" description="Composable multi-panel dock layout using nested ResizableSplitPanes.">
        <ImportStatement code="import { DockLayout } from '@omniviewdev/ui/layout';" />

        <Example title="3-Column Layout" description="Horizontal split with three panels.">
          <Box sx={{ height: 250, border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <DockLayout
              layout={simpleLayout}
              renderPanel={(id) => <PanelContent id={id} color={panelColors[id] ?? 'var(--ov-bg-surface)'} />}
            />
          </Box>
        </Example>

        <Example title="Nested Layout" description="Explorer | (Editor + Terminal) | Properties — IDE-style layout.">
          <Box sx={{ height: 300, border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <DockLayout
              layout={nestedLayout}
              renderPanel={(id) => <PanelContent id={id} color={panelColors[id] ?? 'var(--ov-bg-surface)'} />}
            />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'layout', type: 'DockNode', description: 'Tree structure describing the dock layout.' },
            { name: 'renderPanel', type: '(id: string) => ReactNode', description: 'Render function for leaf panels.' },
          ]}
        />
      </Section>
    </Box>
  );
}
