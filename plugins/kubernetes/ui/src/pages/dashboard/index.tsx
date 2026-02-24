import React from 'react';
import { Outlet } from 'react-router-dom';
import { useExtensionPoint, usePluginRouter } from '@omniviewdev/runtime';
import Box from '@mui/material/Box';
import MuiTabs from '@mui/material/Tabs';
import MuiTab from '@mui/material/Tab';

const builtinTabs: Record<string, string> = {
  '': 'Overview',
  'metrics': 'Metrics',
};

export const DashboardLayout: React.FC = () => {
  const { pluginPath, navigate } = usePluginRouter();

  // Dynamic tabs from extension point
  const tabEP = useExtensionPoint<{ pluginID: string; connectionID: string }>('omniview/dashboard/tab');
  const extensionTabs = tabEP?.list() ?? [];

  // Determine the active tab from the last path segment.
  // pluginPath is e.g. "/cluster/abc/resources" (overview) or "/cluster/abc/resources/metrics"
  const lastSegment = pluginPath.split('/').pop() ?? '';
  const activeTab = lastSegment in builtinTabs ? lastSegment : '';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        bgcolor: 'transparent',
      }}
    >
      <MuiTabs
        value={activeTab}
        onChange={(_e, value) => {
          if (typeof value === 'string') {
            // Relative navigation: 'metrics' goes to sibling, '.' goes to index
            navigate(value || '.', { replace: true });
          }
        }}
        sx={{ bgcolor: 'transparent', minHeight: 0 }}
      >
        {Object.entries(builtinTabs).map(([path, label]) => (
          <MuiTab
            key={path}
            value={path}
            label={label}
            sx={{ minHeight: 32, py: 0.5, textTransform: 'none' }}
          />
        ))}
        {extensionTabs.map((ext) => (
          <MuiTab
            key={ext.id}
            value={(ext as any).path}
            label={ext.label}
            sx={{ minHeight: 32, py: 0.5, textTransform: 'none' }}
          />
        ))}
      </MuiTabs>
      <Box
        component='main'
        sx={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
};

export default DashboardLayout;
