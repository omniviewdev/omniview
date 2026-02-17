import React from 'react';
import { Chip } from '@mui/joy';

type Props = {
  value: string | undefined;
};

const statusColorMap: Record<string, 'success' | 'danger' | 'warning' | 'neutral' | 'primary'> = {
  // EC2
  'running': 'success',
  'stopped': 'danger',
  'terminated': 'danger',
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

  'deleting': 'danger',
  'deleted': 'danger',
  'failed': 'danger',
  'error': 'danger',
  'ERROR': 'danger',
  'FAILED': 'danger',
  'unhealthy': 'danger',
  'UNHEALTHY': 'danger',
  'OutOfService': 'danger',

  'detached': 'neutral',
  'detaching': 'neutral',
};

const StatusCell: React.FC<Props> = ({ value }) => {
  if (!value) return null;

  const color = statusColorMap[value] || 'neutral';

  return (
    <Chip size='sm' variant='soft' color={color} sx={{ borderRadius: 'sm' }}>
      {value}
    </Chip>
  );
};

export default StatusCell;
