import React from 'react';

// Material-ui
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

import { usePlugin } from '@/hooks/plugin/usePluginManager';
import PluginChangelogCard from './PluginChangelogCard';

type Props = {
  id: string;
};

const PluginChangelog: React.FC<Props> = ({ id }) => {
  const { releaseHistory } = usePlugin({ id });

  if (releaseHistory.isLoading) {
    return (
      <Stack direction='column' p={6} gap={3}>
        <Text size='sm' sx={{ color: 'text.secondary' }}>Loading changelog...</Text>
      </Stack>
    );
  }

  if (!releaseHistory.data?.length) {
    return (
      <Stack direction='column' p={6} gap={3}>
        <Text size='sm' sx={{ color: 'text.secondary' }}>No changelog available</Text>
      </Stack>
    );
  }

  return (
    <Stack direction='column' p={6} gap={3} maxHeight={'100%'} overflow={'scroll'}>
      {releaseHistory.data.map((version: any) => (
        <PluginChangelogCard
          key={version.version}
          version={version.version}
          releaseDate={version.created_at ? new Date(version.created_at).toLocaleDateString() : ''}
          changelog={version.changelog || ''}
        />
      ))}
    </Stack>
  );
};

export default PluginChangelog;
