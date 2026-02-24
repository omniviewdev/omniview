import React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';

const Main: React.FC<BoxProps> = props => (
  <Box
    component='main'
    className='Main'
    {...props}
    sx={[{ width: '100%', overflow: 'clip', flex: 1 }, ...(Array.isArray(props.sx) ? props.sx : [props.sx])]}
  />
);

export default Main;
