import React from 'react';
import { Chip } from '@omniviewdev/ui';

type Props = {
  value: string | undefined;
};

const statusColorMap: Record<string, 'success' | 'error' | 'warning' | 'default' | 'primary'> = {
  // EC2
  'running': 'success',
  'stopped': 'error',
  'terminated': 'error',
  'pending': 'warning',
  'stopping': 'warning',
  'shutting-down': 'warning',

  // General
  'available': 'success',
  'active': 'success',
  'ACTIVE': 'success',
  'Active': 'success',
  'in-use': 'success',
  'attached': 'success',
  'enabled': 'success',
  'healthy': 'success',
  'HEALTHY': 'success',
  'InService': 'success',
  'CREATE_COMPLETE': 'success',

  'creating': 'warning',
  'modifying': 'warning',
  'updating': 'warning',
  'provisioning': 'warning',
  'pending-acceptance': 'warning',
  'backing-up': 'warning',
  'rebooting': 'warning',
  'Starting': 'warning',
  'Pending': 'warning',

  'deleting': 'error',
  'deleted': 'error',
  'failed': 'error',
  'error': 'error',
  'ERROR': 'error',
  'FAILED': 'error',
  'unhealthy': 'error',
  'UNHEALTHY': 'error',
  'OutOfService': 'error',

  'detached': 'default',
  'detaching': 'default',
};

const StatusCell: React.FC<Props> = ({ value }) => {
  if (!value) return null;

  const color = statusColorMap[value] || 'default';

  return (
    <Chip size='sm' variant='filled' color={color} label={value} sx={{ borderRadius: 1 }} />
  );
};

export default StatusCell;
