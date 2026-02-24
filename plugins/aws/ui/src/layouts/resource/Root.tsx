import React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';

const Root: React.FC<BoxProps> = (props: BoxProps) => (
  <Box
    {...props}
    sx={[
      {
        bgcolor: 'background.default',
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
