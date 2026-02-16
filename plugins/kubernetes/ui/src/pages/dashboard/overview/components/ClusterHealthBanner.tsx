import React from 'react';
import { Alert, Stack, Typography } from '@mui/joy';
import {
  LuCircleCheck,
  LuTriangleAlert,
  LuCircleX,
} from 'react-icons/lu';

type KubeResource = Record<string, any>;

type Props = {
  nodes: KubeResource[];
  pods: KubeResource[];
  events: KubeResource[];
};

const ClusterHealthBanner: React.FC<Props> = ({ nodes, pods, events }) => {
  const health = React.useMemo(() => {
    const unhealthyNodes = nodes.filter(n => {
      const conditions = n.status?.conditions ?? [];
      const ready = conditions.find((c: any) => c.type === 'Ready');
      return !ready || ready.status !== 'True';
    });

    const failedPods = pods.filter(p => p.status?.phase === 'Failed');
    const pendingPods = pods.filter(p => p.status?.phase === 'Pending');
    const warningEvents = events.filter(e => e.type === 'Warning');

    const issues: string[] = [];
    if (unhealthyNodes.length > 0) issues.push(`${unhealthyNodes.length} node${unhealthyNodes.length > 1 ? 's' : ''} not ready`);
    if (failedPods.length > 0) issues.push(`${failedPods.length} failed pod${failedPods.length > 1 ? 's' : ''}`);
    if (pendingPods.length > 0) issues.push(`${pendingPods.length} pending pod${pendingPods.length > 1 ? 's' : ''}`);
    if (warningEvents.length > 0) issues.push(`${warningEvents.length} warning event${warningEvents.length > 1 ? 's' : ''}`);

    const hasErrors = unhealthyNodes.length > 0 || failedPods.length > 0;

    return { issues, hasErrors };
  }, [nodes, pods, events]);

  if (health.issues.length === 0) {
    return (
      <Alert
        size='sm'
        variant='soft'
        color='success'
        startDecorator={<LuCircleCheck size={14} />}
        sx={{ py: 0.5 }}
      >
        <Typography level='body-xs'>All systems operational</Typography>
      </Alert>
    );
  }

  return (
    <Alert
      size='sm'
      variant='soft'
      color={health.hasErrors ? 'danger' : 'warning'}
      startDecorator={health.hasErrors ? <LuCircleX size={14} /> : <LuTriangleAlert size={14} />}
      sx={{ py: 0.5 }}
    >
      <Stack direction='row' gap={2} flexWrap='wrap'>
        {health.issues.map((issue, i) => (
          <Typography key={i} level='body-xs'>{issue}</Typography>
        ))}
      </Stack>
    </Alert>
  );
};

export default ClusterHealthBanner;
