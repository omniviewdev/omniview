import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { AppShell } from '@omniviewdev/ui/layout';

function MockHeader() {
  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: 'var(--ov-bg-surface)',
        borderBottom: '1px solid var(--ov-border-default)',
        display: 'flex',
        alignItems: 'center',
        px: 2,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--ov-fg-base)' }}>
        Header
      </Typography>
    </Box>
  );
}

function MockSidebar() {
  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: 'var(--ov-bg-subtle)',
        borderRight: '1px solid var(--ov-border-default)',
        p: 1.5,
      }}
    >
      <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', fontWeight: 600 }}>
        Sidebar
      </Typography>
      {['Dashboard', 'Workloads', 'Network', 'Storage'].map((item) => (
        <Typography key={item} variant="body2" sx={{ py: 0.5, color: 'var(--ov-fg-default)', fontSize: '0.8125rem' }}>
          {item}
        </Typography>
      ))}
    </Box>
  );
}

function MockFooter() {
  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: 'var(--ov-bg-surface)',
        borderTop: '1px solid var(--ov-border-default)',
        display: 'flex',
        alignItems: 'center',
        px: 2,
      }}
    >
      <Typography variant="caption" sx={{ color: 'var(--ov-fg-faint)' }}>
        Footer — Status Bar
      </Typography>
    </Box>
  );
}

export default function AppShellPage() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        AppShell
      </Typography>

      <Section
        title="AppShell"
        description="CSS Grid application layout with header, sidebar, main content, and footer slots."
      >
        <ImportStatement code="import { AppShell } from '@omniviewdev/ui/layout';" />

        <Example title="Full Layout">
          <Box sx={{ height: 350, border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <AppShell
              header={<MockHeader />}
              sidebar={<MockSidebar />}
              footer={<MockFooter />}
              sidebarWidth={180}
              headerHeight={40}
              footerHeight={28}
              sx={{ height: '100%', width: '100%' }}
            >
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                  Main content area
                </Typography>
              </Box>
            </AppShell>
          </Box>
        </Example>

        <Example title="Collapsible Sidebar">
          <Button size="small" variant="outlined" onClick={() => setCollapsed(!collapsed)} sx={{ mb: 1 }}>
            {collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          </Button>
          <Box sx={{ height: 300, border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <AppShell
              header={<MockHeader />}
              sidebar={<MockSidebar />}
              sidebarCollapsed={collapsed}
              sidebarWidth={180}
              headerHeight={40}
              sx={{ height: '100%', width: '100%' }}
            >
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                  Main content area — sidebar is {collapsed ? 'collapsed' : 'expanded'}
                </Typography>
              </Box>
            </AppShell>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'header', type: 'ReactNode', description: 'Header slot' },
            { name: 'sidebar', type: 'ReactNode', description: 'Sidebar slot' },
            { name: 'footer', type: 'ReactNode', description: 'Footer slot' },
            { name: 'children', type: 'ReactNode', description: 'Main content' },
            { name: 'sidebarWidth', type: 'number | string', default: '240', description: 'Sidebar width' },
            { name: 'sidebarCollapsed', type: 'boolean', default: 'false', description: 'Collapse sidebar to 0 width' },
            { name: 'headerHeight', type: 'number | string', default: '48', description: 'Header height' },
            { name: 'footerHeight', type: 'number | string', default: '32', description: 'Footer height' },
          ]}
        />
      </Section>
    </Box>
  );
}
