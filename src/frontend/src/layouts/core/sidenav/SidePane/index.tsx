import React from 'react';
import Box, { BoxProps } from '@mui/joy/Box';

/**
 * An optional side pane component for the sidenav layout.
 */
const SidePane: React.FC<BoxProps> = (props) => {
  return (
    <Box
      className="Inbox"
      {...props}
      sx={[
        {
          bgcolor: 'background.surface',
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
}

export default SidePane;

