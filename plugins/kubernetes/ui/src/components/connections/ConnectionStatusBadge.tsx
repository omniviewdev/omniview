import React from 'react';
import { Badge } from '@omniviewdev/ui';

type Props = {
  isConnected: boolean;
  children: React.ReactNode;
};

const ConnectionStatusBadge: React.FC<Props> = ({ isConnected, children }) => (
  <Badge
    color='success'
    invisible={!isConnected}
    size='sm'
    anchorOrigin={{
      vertical: 'top',
      horizontal: 'right',
    }}
    sx={isConnected ? {
      '& .MuiBadge-dot': {
        animation: 'ov-pulse 2s ease-in-out infinite',
        boxShadow: '0 0 0 0 var(--ov-success-default, #4caf50)',
      },
      '@keyframes ov-pulse': {
        '0%': { boxShadow: '0 0 0 0 rgba(76, 175, 80, 0.5)' },
        '70%': { boxShadow: '0 0 0 5px rgba(76, 175, 80, 0)' },
        '100%': { boxShadow: '0 0 0 0 rgba(76, 175, 80, 0)' },
      },
    } : undefined}
  >
    {children}
  </Badge>
);

export default ConnectionStatusBadge;
