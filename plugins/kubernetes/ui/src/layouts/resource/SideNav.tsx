import React from 'react';

// Material-ui
import { Box } from '@mui/joy';

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
          padding: padding ?? 0,
          minWidth: {
            xs: width ?? 0,
            sm: width ?? 200,
            md: width ?? 240,
            lg: width ?? 280,
          },
          maxWidth: {
            xs: width ?? 0,
            sm: width ?? 200,
            md: width ?? 240,
            lg: width ?? 280,
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
