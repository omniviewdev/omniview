import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { ResizableSplitPane } from '../../layout';

function PaneContent({ label, color }: { label: string; color: string }) {
  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: color,
        color: 'var(--ov-fg-base)',
        fontSize: '0.875rem',
        fontWeight: 600,
      }}
    >
      {label}
    </Box>
  );
}

export default function ResizableSplitPanePage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        ResizableSplitPane
      </Typography>

      <Section
        title="ResizableSplitPane"
        description="Two-pane resizable layout with a drag handle. Double-click the handle to toggle between default and min size."
      >
        <ImportStatement code="import { ResizableSplitPane } from '@omniviewdev/ui/layout';" />

        <Example title="Horizontal (Default)">
          <Box sx={{ height: 250, border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <ResizableSplitPane defaultSize={200} minSize={100} maxSize={500}>
              <PaneContent label="Left Pane" color="var(--ov-bg-subtle)" />
              <PaneContent label="Right Pane" color="var(--ov-bg-surface)" />
            </ResizableSplitPane>
          </Box>
        </Example>

        <Example title="Vertical">
          <Box sx={{ height: 350, border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <ResizableSplitPane direction="vertical" defaultSize={150} minSize={80} maxSize={280}>
              <PaneContent label="Top Pane" color="var(--ov-bg-subtle)" />
              <PaneContent label="Bottom Pane" color="var(--ov-bg-surface)" />
            </ResizableSplitPane>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'direction', type: "'horizontal' | 'vertical'", default: "'horizontal'", description: 'Split direction' },
            { name: 'defaultSize', type: 'number', default: '300', description: 'Initial size of first pane in px' },
            { name: 'minSize', type: 'number', default: '100', description: 'Minimum size of first pane' },
            { name: 'maxSize', type: 'number', description: 'Maximum size of first pane' },
            { name: 'onResize', type: '(size: number) => void', description: 'Callback on resize' },
            { name: 'handleSize', type: 'number', default: '4', description: 'Width/height of the drag handle' },
            { name: 'id', type: 'string', description: 'Enables localStorage persistence' },
          ]}
        />
      </Section>
    </Box>
  );
}
