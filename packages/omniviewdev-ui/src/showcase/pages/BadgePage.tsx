import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuBell, LuMail, LuMessageSquare } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Badge } from '../../index';
import { IconButton } from '../../buttons';

export default function BadgePage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Badge
      </Typography>

      <Section
        title="Badge"
        description="Wraps MUI Badge with semantic color mapping."
      >
        <ImportStatement code="import { Badge } from '@omniviewdev/ui';" />

        <Example title="Counts">
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Badge count={4} color="primary">
              <IconButton size="sm"><LuBell size={18} /></IconButton>
            </Badge>
            <Badge count={12} color="error">
              <IconButton size="sm"><LuMail size={18} /></IconButton>
            </Badge>
            <Badge count={150} max={99} color="warning">
              <IconButton size="sm"><LuMessageSquare size={18} /></IconButton>
            </Badge>
          </Box>
        </Example>

        <Example title="Dot Variant">
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Badge dot color="success">
              <IconButton size="sm"><LuBell size={18} /></IconButton>
            </Badge>
            <Badge dot color="error">
              <IconButton size="sm"><LuMail size={18} /></IconButton>
            </Badge>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'count', type: 'number', description: 'Badge count value' },
            { name: 'dot', type: 'boolean', default: 'false', description: 'Show as dot instead of count' },
            { name: 'color', type: 'SemanticColor', default: "'primary'", description: 'Badge color' },
            { name: 'max', type: 'number', default: '99', description: 'Max display count (shows 99+)' },
          ]}
        />
      </Section>
    </Box>
  );
}
