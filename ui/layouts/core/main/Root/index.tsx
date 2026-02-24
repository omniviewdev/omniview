import React from 'react';

// Material-ui
import Box, { type BoxProps } from '@mui/material/Box';

/**
 * The root component for the main layout. All components within the layout should be children of this component.
 */
const Root: React.FC<BoxProps> = props => (
  <Box
    {...props}
    sx={[
      {
        bgcolor: 'background.default',
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'minmax(64px, 200px) minmax(450px, 1fr)',
          md: 'minmax(160px, 300px) minmax(300px, 500px) minmax(500px, 1fr)',
        },
        gridTemplateRows: '64px 1fr',
        minHeight: 'calc(100vh - var(--CoreLayoutHeader-height))',
      },
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  />
);

export default Root;
