import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

// material-ui
import {
  Divider,
  Sheet,
  Stack,
  Typography,
} from '@mui/joy';


// Layout
import Layout from '../layouts/main';
import NavMenu from '../components/NavMenu';
import { SidebarSection } from '../components/types';

const sections: SidebarSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    items: [
      { id: '/', label: 'Dashboard', icon: 'LuHome' },
      { id: '/scan', label: 'Scan', icon: 'LuCamera' },
    ]
  }
];

export default function RootLayout(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  console.log(navigate);

  const handleSelect = (id: string) => {
    console.log('selected', id);
    navigate(id);
  }

  return (
    <Stack
      overflow={'auto'}
      direction={'column'}
      alignItems={'flex-start'}
      minHeight={300}
      flex={1}
    >
      <Sheet
        sx={{
          py: 1,
          px: 1,
          width: '100%',
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        variant='soft'
      >
        <Stack direction='row' alignItems='center' gap={2}>
          <Typography level='title-md' >{'Container Explorer'}</Typography>
        </Stack>
      </Sheet>
      <Divider />
      <Layout.Root
        sx={{
          p: 0,
          gap: 0,
          width: '100%',
        }}
      >
        <Layout.SideNav type='bordered' width={200}>
          <NavMenu sections={sections} selected={location.pathname} onSelect={handleSelect} />
        </Layout.SideNav>
        <Layout.Main>
          {location.pathname}
          <Outlet />
        </Layout.Main>
      </Layout.Root>
    </Stack>
  );
}
