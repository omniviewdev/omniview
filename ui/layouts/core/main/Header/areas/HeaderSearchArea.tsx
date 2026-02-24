import React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { TextField } from '@omniviewdev/ui/inputs';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';

// Icons
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';

/**
 * The search area in the header.
 */
const HeaderSearchArea: React.FC = () => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'row',
      gap: 1,
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      px: 0.5,
      WebkitUserSelect: 'none',
    }}
  >
    <TextField
      size='xs'
      placeholder='Search anything…'
      startAdornment={<SearchRoundedIcon color='primary' fontSize='small' />}
      endAdornment={
        <IconButton emphasis='outline' color='neutral' size='sm'>
          <Text size='sm'>
            ⌘ + k
          </Text>
        </IconButton>
      }
      sx={{
        flexBasis: '500px',
        display: 'flex',
        boxShadow: 'none',
        minWidth: {
          md: 400,
          lg: 400,
          xl: 500,
        },
        '--wails-draggable': 'no-drag',
      }}
    />
    {/* <TabBarProvider /> */}
  </Box>

);

export default HeaderSearchArea;
