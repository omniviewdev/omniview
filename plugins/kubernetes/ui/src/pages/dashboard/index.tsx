import React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { usePluginRouter } from '@omniviewdev/runtime';
import {
  Box,
  Tabs,
  Tab,
  Sheet,
  TabList,
} from '@mui/joy';

const tabs: Record<string, string> = {
  "": "Overview",
  "/benchmarks": "Benchmarks"
}

export const DashboardLayout: React.FC = () => {
  const { id } = useParams()
  const { location, navigate } = usePluginRouter();

  console.log(location)

  return (
    <Sheet
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        bgcolor: 'transparent'
      }}
    >
      <Tabs
        size='sm'
        value={location.pathname.replace("/_plugin/kubernetes/", "/")}
        onChange={(_, value) => {
          if (typeof value === 'string') {
            navigate(value);
          }
        }}
        variant='plain'
        sx={{
          bgcolor: 'transparent',
        }}
      >
        <TabList underlinePlacement={'bottom'}>
          {Object.entries(tabs).map(([path, label]) => (
            <Tab key={path} indicatorPlacement={'bottom'} value={`/cluster/${id}/resources${path}`}>
              {label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      <Box
        component="main"
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
}

export default DashboardLayout
