import React from 'react';
import { Badge } from '@mui/joy';

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
  >
    {children}
  </Badge>
);

export default ConnectionStatusBadge;
