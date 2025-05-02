import React from 'react';

// MaterialUI
import {
  Typography,
  Sheet,
  Stack,
} from '@mui/joy';

// Project imports
import SearchInput from '../shared/SearchInput';

// Icons
import { SiKubernetes } from 'react-icons/si';

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  plugin: string;
};

/**
 * Header component for the connections list on the landing page for the resource plugin.
 */
const ConnectionListHeader: React.FC<Props> = ({ search, onSearchChange }) => (
  <Sheet
    sx={{
      px: 0.5,
      py: 0.5,
      backgroundColor: 'background.surface',
      display: 'flex',
      width: '100%',
      borderRadius: 'sm',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 1,
    }}
    variant='outlined'
  >
    {/* Left side of the header */}
    <Stack
      direction='row'
      alignItems='center'
      gap={1}
      pl={1}
    >
      <SiKubernetes size={20} />
      <Typography fontSize={16} fontWeight={600}>Clusters</Typography>
    </Stack>

    {/* Right side of the header */}
    <Stack direction='row' alignItems='center' gap={1.5}>
      <SearchInput
        placeholder='Search connections'
        value={search}
        onChange={onSearchChange}
      />
    </Stack>
  </Sheet>
);

export default ConnectionListHeader;
