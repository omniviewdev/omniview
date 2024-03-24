import React from 'react';

// Material-ui
import Typography from '@mui/joy/Typography';
import Sheet from '@mui/joy/Sheet';

// Project imports
import { SearchInput } from '@/components/inputs';

// Icons
import { TbCloudDataConnection } from 'react-icons/tb';
import { Stack } from '@mui/joy';

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
      px: 2,
      py: 1,
      backgroundColor: 'background.surface',
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 1,
    }}
    variant='plain'
  >
    {/* Left side of the header */}
    <Stack direction='row' alignItems='center' gap={1.5}>
      <TbCloudDataConnection size={20} />
      <Typography fontSize={16} fontWeight={600}>Connections</Typography>
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
