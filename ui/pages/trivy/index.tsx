import React from 'react';
import { Outlet } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import { Avatar } from '@omniviewdev/ui';

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
 * We love Aqua
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
      <Box
        sx={{
          py: 1,
          px: 2,
          width: '100%',
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'action.hover',
        }}
      >
        <Stack direction='row' alignItems='center' gap={2}>
          <Avatar
            size='sm'
            src={'https://raw.githubusercontent.com/aquasecurity/trivy-docker-extension/main/trivy.svg'}
            sx={{
              borderRadius: 4,
              height: 24,
              width: 24,
            }}
          />
          <Heading level={4}>{'Trivy'}</Heading>
        </Stack>
        <Text weight='semibold' size='sm'>{'Scan your resources, clusters and more with native support for Aqua Trivy'}</Text>
      </Box>
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
