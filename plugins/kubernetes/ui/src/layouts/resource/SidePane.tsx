import React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';

/**
 * An optional side pane component for the sidenav layout.
 */
const SidePane: React.FC<BoxProps> = props => (
  <Box
    className='Inbox'
    {...props}
    sx={[
      {
        bgcolor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
        display: {
          xs: 'none',
          md: 'initial',
        },
      },
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  />
);

export default SidePane;
