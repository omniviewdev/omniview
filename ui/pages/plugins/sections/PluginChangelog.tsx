import React from 'react';

import { Stack, Text } from '@omniviewdev/base-ui';

import { usePlugin } from '@/hooks/plugin/usePluginManager';
import PluginChangelogCard from './PluginChangelogCard';
import styles from './PluginChangelog.module.css';

type Props = {
  id: string;
};

const PluginChangelog: React.FC<Props> = ({ id }) => {
  const { releaseHistory } = usePlugin({ id });

  if (releaseHistory.isLoading) {
    return (
      <Stack direction='column' spacing={4} className={styles.Root}>
        <Text size='sm' tone='muted'>Loading changelog...</Text>
      </Stack>
    );
  }

  if (!releaseHistory.data?.length) {
    return (
      <Stack direction='column' spacing={4} className={styles.Root}>
        <Text size='sm' tone='muted'>No changelog available</Text>
      </Stack>
    );
  }

  return (
    <Stack direction='column' spacing={4} className={styles.Root}>
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
