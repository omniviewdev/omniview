import React from 'react';

// material-ui
import Box, { type BoxProps } from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';

/**
 * The root component for the main layout. All components within the layout should be children of this component.
 */
const Footer: React.FC<BoxProps> = props => (
  <React.Fragment>
    <GlobalStyles
      styles={{
        // eslint-disable-next-line @typescript-eslint/naming-convention
        ':root': {
          '--CoreLayoutFooter-height': '20px',
        },
      }}
    />

    <Box
      {...props}
      sx={[
        {
          borderTop: (theme: any) => `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
          minWidth: '100vw',
          minHeight: 'var(--CoreLayoutFooter-height)',
          maxHeight: 'var(--CoreLayoutFooter-height)',
          display: 'flex',
          p: '4px',
        },
        ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
      ]}
    />
  </React.Fragment>
);

export default Footer;
