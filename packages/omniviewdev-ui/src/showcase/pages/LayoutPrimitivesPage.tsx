import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Stack, Inline, Spacer } from '../../layout';

function ColorBox({ label, color }: { label: string; color: string }) {
  return (
    <Box
      sx={{
        width: 80,
        height: 40,
        bgcolor: color,
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'var(--ov-fg-base)',
        border: '1px solid var(--ov-border-muted)',
      }}
    >
      {label}
    </Box>
  );
}

export default function LayoutPrimitivesPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Stack, Inline & Spacer
      </Typography>

      {/* Stack */}
      <Section
        title="Stack"
        description="Flexbox column/row layout with gap, alignment, optional dividers."
      >
        <ImportStatement code="import { Stack } from '@omniviewdev/ui/layout';" />

        <Example title="Column (Default)">
          <Stack gap={1}>
            <ColorBox label="A" color="var(--ov-bg-subtle)" />
            <ColorBox label="B" color="var(--ov-bg-subtle)" />
            <ColorBox label="C" color="var(--ov-bg-subtle)" />
          </Stack>
        </Example>

        <Example title="Row">
          <Stack direction="row" gap={1}>
            <ColorBox label="A" color="var(--ov-bg-subtle)" />
            <ColorBox label="B" color="var(--ov-bg-subtle)" />
            <ColorBox label="C" color="var(--ov-bg-subtle)" />
          </Stack>
        </Example>

        <Example title="With Dividers">
          <Stack direction="row" gap={2} divider>
            <ColorBox label="A" color="var(--ov-bg-subtle)" />
            <ColorBox label="B" color="var(--ov-bg-subtle)" />
            <ColorBox label="C" color="var(--ov-bg-subtle)" />
          </Stack>
        </Example>

        <PropsTable
          props={[
            { name: 'direction', type: "'row' | 'column'", default: "'column'", description: 'Flex direction' },
            { name: 'gap', type: 'number', default: '1', description: 'Gap between children (MUI spacing units)' },
            { name: 'align', type: 'string', description: 'CSS align-items' },
            { name: 'justify', type: 'string', description: 'CSS justify-content' },
            { name: 'wrap', type: 'boolean', default: 'false', description: 'Enable flex-wrap' },
            { name: 'divider', type: 'boolean', default: 'false', description: 'Insert dividers between children' },
          ]}
        />
      </Section>

      {/* Inline */}
      <Section
        title="Inline"
        description="Convenience wrapper for Stack with direction='row' and wrap enabled. Good for tags, chips, badges."
      >
        <ImportStatement code="import { Inline } from '@omniviewdev/ui/layout';" />

        <Example title="Inline Tags">
          <Inline gap={1}>
            {['kubernetes', 'docker', 'helm', 'istio', 'prometheus', 'grafana', 'terraform', 'argocd'].map((tag) => (
              <Chip key={tag} label={tag} size="small" variant="outlined" />
            ))}
          </Inline>
        </Example>

        <PropsTable
          props={[
            { name: 'gap', type: 'number', default: '1', description: 'Gap between children' },
            { name: 'align', type: 'string', default: "'center'", description: 'CSS align-items' },
            { name: 'justify', type: 'string', description: 'CSS justify-content' },
            { name: 'divider', type: 'boolean', default: 'false', description: 'Insert dividers between children' },
          ]}
        />
      </Section>

      {/* Spacer */}
      <Section
        title="Spacer"
        description="A flex: 1 div that pushes siblings apart."
      >
        <ImportStatement code="import { Spacer } from '@omniviewdev/ui/layout';" />

        <Example title="Push Items Apart">
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1,
              border: '1px solid var(--ov-border-default)',
              borderRadius: '6px',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--ov-fg-base)' }}>
              Title
            </Typography>
            <Spacer />
            <Chip label="Badge" size="small" color="primary" />
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
