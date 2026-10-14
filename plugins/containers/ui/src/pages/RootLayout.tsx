import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

// UI
import { Separator, Stack, Text } from '@omniviewdev/base-ui';


// Layout
import Layout from '../layouts/main';
import NavMenu from '../components/NavMenu';
import { SidebarSection } from '../components/types';

const sections: SidebarSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    items: [
      { id: '/', label: 'Dashboard', icon: 'LuHouse' },
      { id: '/scan', label: 'Scan', icon: 'LuCamera' },
    ]
  }
];

const headerStyle: React.CSSProperties = {
  paddingBlock: 8,
  paddingInline: 8,
  width: '100%',
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  justifyContent: 'space-between',
  backgroundColor: 'var(--ov-color-state-hover)',
  boxSizing: 'border-box',
};

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
      direction='column'
      align='start'
      spacing={2}
      style={{ overflow: 'auto', minHeight: 300, flex: 1 }}
    >
      <div style={headerStyle}>
        <Stack direction='row' align='center' spacing={4}>
          <Text weight="semibold" size="md">{'Container Explorer'}</Text>
        </Stack>
      </div>
      <Separator style={{ alignSelf: 'stretch' }} />
      <Layout.Root
        style={{
          padding: 0,
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
