import React from 'react';
import Box, { type BoxProps } from '@mui/joy/Box';

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
        // minHeight: '100%',
        // maxHeight: '100%',
        // Display: 'grid',
        // gridTemplateColumns: {
        //   xs: '1fr',
        //   sm: 'minmax(64px, 200px) minmax(450px, 1fr)',
        //   md: 'minmax(160px, 300px) minmax(300px, 500px) minmax(500px, 1fr)',
        // },
        // gridTemplateRows: '64px 1fr',
      },
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  />
);

export default Root;
