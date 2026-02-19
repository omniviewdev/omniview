import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Avatar } from '../../index';

export default function AvatarPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Avatar
      </Typography>

      <Section
        title="Avatar"
        description="Avatar with initials, color hash, or image. Wraps MUI Avatar."
      >
        <ImportStatement code="import { Avatar } from '@omniviewdev/ui';" />

        <Example title="From Name (Initials + Color Hash)">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Avatar name="John Doe" />
            <Avatar name="Alice Smith" />
            <Avatar name="Kubernetes" />
            <Avatar name="Prometheus" />
            <Avatar name="Grafana" />
          </Box>
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
              <Box key={s} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Avatar name="Josh Pare" size={s} />
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)' }}>{s}</Typography>
              </Box>
            ))}
          </Box>
        </Example>

        <Example title="Without Name (Fallback)">
          <Avatar />
        </Example>

        <PropsTable
          props={[
            { name: 'src', type: 'string', description: 'Image source URL' },
            { name: 'name', type: 'string', description: 'Name for initials and color generation' },
            { name: 'size', type: 'ComponentSize', default: "'md'", description: 'Avatar size' },
            { name: 'color', type: 'SemanticColor', description: 'Explicit background color' },
          ]}
        />
      </Section>
    </Box>
  );
}
