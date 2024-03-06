import React from 'react';
import Box, { BoxProps } from '@mui/joy/Box';

/**
 * The main component for the sidenav layout.
 */
const Main: React.FC<BoxProps> = (props) => {
  return (
    <Box
      component="main"
      className="Main"
      {...props}
      sx={[{ width: '100%' }, ...(Array.isArray(props.sx) ? props.sx : [props.sx])]}
    />
  );
}

export default Main;
