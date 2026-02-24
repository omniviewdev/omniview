import React from 'react';

// Material-ui
import Box from '@mui/material/Box';

type Props = {
  padding?: number;
  width?: number;
  type?: 'inset' | 'bordered' | 'transparent' | 'bordered-inset';
  scrollable?: boolean;
  children: React.ReactNode;
};

/**
 * The side navigation component for the sidenav layout
 */
const SideNav: React.FC<Props> = ({ type = 'inset', scrollable = false, children, width, padding }) => {
  const BorderedSx = {
    bgcolor: '#131315',
    borderRight: '1px solid',
    borderColor: 'divider',
  };
  const InsetSx = {
    bgcolor: 'transparent',
  };
  const TransparentSx = {
    bgcolor: 'transparent',
    borderRight: '1px solid',
    borderColor: 'divider',
  };
  const BorderedInsetSx = {
    bgcolor: 'transparent',
    border: '1px solid',
    borderRadius: 'md',
    borderColor: 'divider',
  };

  const scrollableSx = {
    overflow: 'auto',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': {
      display: 'none',
    },
    '&-ms-overflow-style:': {
      display: 'none',
    },
  };

  return (
    <Box
      component='nav'
      className='Navigation'
      sx={[
        {
          minHeight: '100%',
          maxHeight: '100%',
          padding: padding ?? 0.5,
          minWidth: {
            xs: width ?? 0,
            sm: width ?? 160,
            md: width ?? 200,
            lg: width ?? 240,
          },
          display: {
            xs: 'none',
            sm: 'initial',
          },
        },
        type === 'bordered' && BorderedSx,
        type === 'inset' && InsetSx,
        type === 'transparent' && TransparentSx,
        type === 'bordered-inset' && BorderedInsetSx,
        scrollable && scrollableSx,
      ]}
    >
      {children}
    </Box>
  );
};

export default SideNav;
