import React from 'react';

// material-ui
import Box from '@mui/joy/Box';

type Props = {
  type?: 'inset' | 'bordered';
  children: React.ReactNode;
}

/**
 * The side navigation component for the sidenav layout
 */
const SideNav: React.FC<Props> = ({ type = 'inset', children }) => {
  const BorderedSx = {
    bgcolor: 'background.surface',
    borderRight: '1px solid',
    borderColor: 'divider',
  }
  const InsetSx = {
    bgcolor: 'transparent',
  }

  return (
    <Box
      component="nav"
      className="Navigation"
      sx={[
        {
          minWidth: {
            xs: 0,
            sm: 160,
            md: 200,
            lg: 240,
          },
          display: {
            xs: 'none',
            sm: 'initial',
          },
        },
        type === 'bordered' && BorderedSx,
        type === 'inset' && InsetSx,
      ]}
    >
      {children}
    </Box>
  );
}

export default SideNav;