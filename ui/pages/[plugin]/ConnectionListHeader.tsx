import React from 'react';

// ui
import { Stack, Text } from '@omniviewdev/base-ui';

// Project imports
import { SearchInput } from '@/components/inputs';

// Icons
import { TbCloudDataConnection } from 'react-icons/tb';
import styles from './ConnectionListHeader.module.css';

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  plugin: string;
};

/**
 * Header component for the connections list on the landing page for the resource plugin.
 */
const ConnectionListHeader: React.FC<Props> = ({ search, onSearchChange }) => (
  <div className={styles.Root}>
    {/* Left side of the header */}
    <Stack direction='row' align='center' spacing={2} className={styles.Title}>
      <TbCloudDataConnection size={20} />
      <Text className={styles.TitleText}>Connections</Text>
    </Stack>

    {/* Right side of the header */}
    <Stack direction='row' align='center' spacing={3}>
      <SearchInput
        placeholder='Search connections'
        value={search}
        onChange={onSearchChange}
      />
    </Stack>
  </div>
);

export default ConnectionListHeader;
