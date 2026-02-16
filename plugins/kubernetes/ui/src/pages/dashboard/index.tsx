import React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useExtensionPoint, usePluginRouter } from '@omniviewdev/runtime';
import {
  Box,
  Tabs,
  Tab,
  Sheet,
  TabList,
} from '@mui/joy';

const builtinTabs: Record<string, string> = {
  '': 'Overview',
  '/benchmarks': 'Benchmarks',
};

export const DashboardLayout: React.FC = () => {
  const { id } = useParams();
  const { location, navigate } = usePluginRouter();

  // Dynamic tabs from extension point
  const tabEP = useExtensionPoint<{ pluginID: string; connectionID: string }>('omniview/dashboard/tab');
  const extensionTabs = tabEP?.list() ?? [];

  return (
    <Sheet
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        bgcolor: 'transparent',
      }}
    >
      <Tabs
        size='sm'
        value={location.pathname.replace('/_plugin/kubernetes/', '/')}
        onChange={(_, value) => {
          if (typeof value === 'string') {
            navigate(value);
          }
        }}
        variant='plain'
        sx={{ bgcolor: 'transparent' }}
      >
        <TabList underlinePlacement='bottom'>
          {Object.entries(builtinTabs).map(([path, label]) => (
            <Tab key={path} indicatorPlacement='bottom' value={`/cluster/${id}/resources${path}`}>
              {label}
            </Tab>
          ))}
          {extensionTabs.map((tab) => {
            const meta = tab.meta as { label?: string; path?: string } | undefined;
            const label = meta?.label ?? tab.label ?? tab.id;
            const path = meta?.path ?? tab.id;
            return (
              <Tab key={tab.id} indicatorPlacement='bottom' value={`/cluster/${id}/resources/${path}`}>
                {label}
              </Tab>
            );
          })}
        </TabList>
      </Tabs>
      <Box
        component='main'
        sx={{
          flex: 1,
          display: 'flex',
          overflow: 'auto',
        }}
      >
        <Outlet />
      </Box>
    </Sheet>
  );
};

export default DashboardLayout;
