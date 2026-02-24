import React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// Project imports
import { SearchInput } from '@/components/inputs';

// Icons
import { TbCloudDataConnection } from 'react-icons/tb';

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  plugin: string;
};

/**
 * Header component for the connections list on the landing page for the resource plugin.
 */
const ConnectionListHeader: React.FC<Props> = ({ search, onSearchChange }) => (
  <Box
    sx={{
      px: 0.5,
      py: 0.5,
      backgroundColor: 'background.paper',
      display: 'flex',
      width: '100%',
      borderRadius: 1,
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 1,
      border: '1px solid',
      borderColor: 'divider',
    }}
  >
    {/* Left side of the header */}
    <Stack
      direction='row'
      alignItems='center'
      gap={1}
      pl={1}
    >
      <TbCloudDataConnection size={20} />
      <Text sx={{ fontSize: 16, fontWeight: 600 }}>Connections</Text>
    </Stack>

    {/* Right side of the header */}
    <Stack direction='row' alignItems='center' gap={1.5}>
      <SearchInput
        placeholder='Search connections'
        value={search}
        onChange={onSearchChange}
      />
    </Stack>
  </Box>
);

export default ConnectionListHeader;
