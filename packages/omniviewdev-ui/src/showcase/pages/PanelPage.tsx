import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import { LuSettings, LuRefreshCw, LuTerminal } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Panel } from '../../layout';

export default function PanelPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Panel
      </Typography>

      <Section
        title="Panel"
        description="IDE panel component with header bar, toolbar actions, collapsible content, and close button."
      >
        <ImportStatement code="import { Panel } from '@omniviewdev/ui/layout';" />

        <Example title="Basic">
          <Panel title="Output">
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                Panel content goes here.
              </Typography>
            </Box>
          </Panel>
        </Example>

        <Example title="With Icon and Toolbar">
          <Panel
            title="Terminal"
            icon={<LuTerminal size={14} />}
            toolbar={
              <>
                <MuiIconButton size="small" sx={{ p: 0.25 }}>
                  <LuRefreshCw size={14} />
                </MuiIconButton>
                <MuiIconButton size="small" sx={{ p: 0.25 }}>
                  <LuSettings size={14} />
                </MuiIconButton>
              </>
            }
          >
            <Box sx={{ p: 2, fontFamily: 'var(--ov-font-mono)', fontSize: '0.75rem', color: 'var(--ov-fg-default)' }}>
              $ kubectl get pods
              <br />
              NAME&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;READY&nbsp;&nbsp;STATUS
              <br />
              nginx-abc123&nbsp;&nbsp;&nbsp;1/1&nbsp;&nbsp;&nbsp;&nbsp;Running
            </Box>
          </Panel>
        </Example>

        <Example title="Collapsible">
          <Panel title="Details" collapsible>
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                Click the chevron to collapse this panel.
              </Typography>
            </Box>
          </Panel>
        </Example>

        <Example title="With Close Button">
          <Panel title="Logs" onClose={() => alert('Close clicked')}>
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                Panel with a close button in the header.
              </Typography>
            </Box>
          </Panel>
        </Example>

        <Example title="Elevation Variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(['flat', 'raised', 'overlay'] as const).map((elev) => (
              <Panel key={elev} title={`Elevation: ${elev}`} elevation={elev}>
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                    {elev} elevation
                  </Typography>
                </Box>
              </Panel>
            ))}
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'title', type: 'string', description: 'Panel title in header' },
            { name: 'icon', type: 'ReactNode', description: 'Icon before the title' },
            { name: 'toolbar', type: 'ReactNode', description: 'Toolbar actions in header' },
            { name: 'collapsible', type: 'boolean', default: 'false', description: 'Enable collapse toggle' },
            { name: 'onClose', type: '() => void', description: 'Show close button in header' },
            { name: 'elevation', type: "'flat' | 'raised' | 'overlay'", default: "'flat'", description: 'Surface depth' },
          ]}
        />
      </Section>
    </Box>
  );
}
