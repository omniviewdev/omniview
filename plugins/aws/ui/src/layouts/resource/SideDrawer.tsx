import React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';

type Props = BoxProps & {
  onClose: React.MouseEventHandler<HTMLDivElement>;
};

/**
 * An optional side drawer component for the sidenav layout.
 */
const SideDrawer: React.FC<Props> = ({ onClose, ...props }) => (
  <Box
    {...props}
    sx={[
      {
        position: 'fixed', zIndex: 1200, width: '100%', height: '100%',
      },
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  >
    <Box
      role='button'
      onClick={onClose}
      sx={{
        position: 'absolute',
        inset: 0,
        bgcolor: 'rgba(0, 0, 0, 0.8)',
      }}
    />
    <Box
      sx={{
        minWidth: 256,
        width: 'max-content',
        height: '100%',
        p: 2,
        boxShadow: 3,
        bgcolor: 'background.paper',
      }}
    >
      {props.children}
    </Box>
  </Box>
);

export default SideDrawer;
