import React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';

/**
 * The root component for the generic sidemenu layout
 */
const Root: React.FC<BoxProps> = (props: BoxProps) => (
  <Box
    {...props}
    sx={[
      {
        bgcolor: 'background.appBody',
        display: 'flex',
        flexDirection: 'row',
        flexGrow: 1,
        overflow: 'hidden',
      },
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  />
);

export default Root;
