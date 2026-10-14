import React from 'react';
import { Badge } from '@omniviewdev/base-ui';

type Props = {
  isConnected: boolean;
  children: React.ReactNode;
};

const ConnectionStatusBadge: React.FC<Props> = ({ isConnected, children }) => (
  <Badge
    variant='dot'
    color='success'
    invisible={!isConnected}
    size='sm'
    position='top-right'
  >
    {children}
  </Badge>
);

export default ConnectionStatusBadge;
