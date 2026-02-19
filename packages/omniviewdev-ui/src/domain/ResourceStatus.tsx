import Box from '@mui/material/Box';
import type { ComponentSize } from '../types';
import type { Status } from '../types';
import { StatusPill } from '../feedback';
import { Tooltip } from '../overlays';
import Typography from '@mui/material/Typography';

export interface ResourceStatusProps {
  status: string;
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  size?: ComponentSize;
  showTooltip?: boolean;
}

const statusMap: Record<string, Status> = {
  Running: 'healthy',
  Active: 'healthy',
  Bound: 'healthy',
  Available: 'healthy',
  Ready: 'healthy',
  Succeeded: 'healthy',
  Completed: 'healthy',
  Pending: 'pending',
  ContainerCreating: 'pending',
  Terminating: 'warning',
  Warning: 'warning',
  Degraded: 'degraded',
  CrashLoopBackOff: 'error',
  Failed: 'error',
  Error: 'error',
  ImagePullBackOff: 'error',
  ErrImagePull: 'error',
  OOMKilled: 'error',
  Unknown: 'unknown',
};

export default function ResourceStatus({
  status,
  conditions,
  size = 'sm',
  showTooltip = true,
}: ResourceStatusProps) {
  const mappedStatus = statusMap[status] ?? 'unknown';

  const pill = (
    <StatusPill status={mappedStatus} label={status} size={size} />
  );

  if (showTooltip && conditions && conditions.length > 0) {
    return (
      <Tooltip
        variant="rich"
        title={
          <Box sx={{ maxWidth: 360 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Conditions
            </Typography>
            {conditions.map((c, i) => (
              <Box key={i} sx={{ mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {c.type}: {c.status}
                </Typography>
                {c.reason && (
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    {c.reason}
                  </Typography>
                )}
                {c.message && (
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.65rem' }}>
                    {c.message}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        }
      >
        <Box sx={{ display: 'inline-flex' }}>{pill}</Box>
      </Tooltip>
    );
  }

  return pill;
}

ResourceStatus.displayName = 'ResourceStatus';
