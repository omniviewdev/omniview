import React from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import Input from '@mui/joy/Input';
import IconButton from '@mui/joy/IconButton';
import Typography from '@mui/joy/Typography';

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
    <Input
      size='sm'
      variant='outlined'
      placeholder='Search anything…'
      startDecorator={<SearchRoundedIcon color='primary' fontSize='small' />}
      endDecorator={
        <IconButton variant='outlined' color='neutral'>
          <Typography fontWeight='lg' fontSize='sm' textColor='text.icon'>
            ⌘ + k
          </Typography>
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
