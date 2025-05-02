import React from 'react';
import { Outlet } from 'react-router-dom';

// material-ui
import Avatar from '@mui/joy/Avatar';
import Divider from '@mui/joy/Divider';
import Sheet from '@mui/joy/Sheet';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// Layout
import Layout from '@/layouts/core/sidenav';
import TrivyNav from './TrivyNav';

const sections = [
  { id: 'vulnerability', label: 'Vulnerability', icon: 'LuShieldCheck' },
  { id: 'misconfiguration', label: 'Misconfiguration', icon: 'LuSettings' },
  { id: 'license', label: 'License', icon: 'LuScale' },
  { id: 'sbom', label: 'SBOM', icon: 'LuPackageSearch' },
];

/**
 * Integration Trivy in natively with Omniview as it's primary security scanner.
 * We ❤️  Aqua
 */
export default function TrivyPluginHome(): React.ReactElement {
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
          px: 2,
          width: '100%',
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        variant='soft'
      >
        <Stack direction='row' alignItems='center' gap={2}>
          <Avatar
            size='sm'
            src={'https://raw.githubusercontent.com/aquasecurity/trivy-docker-extension/main/trivy.svg'}
            variant='plain'
            sx={{
              borderRadius: 4,
              height: 24,
              width: 24,
            }}
          />
          <Typography level='h4' >{'Trivy'}</Typography>
        </Stack>
        <Typography level='title-sm' >{'Scan your resources, clusters and more with native support for Aqua Trivy'}</Typography>
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
          <TrivyNav sections={sections} />
        </Layout.SideNav>
        <Layout.Main>
          <Outlet />
        </Layout.Main>
      </Layout.Root>
    </Stack>
  );
}
