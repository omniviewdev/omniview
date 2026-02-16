import React from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/joy';
import {
  LuCircleCheck,
  LuCircleX,
  LuCpu,
  LuGlobe,
  LuLayers,
  LuRefreshCw,
  LuServer,
  LuTag,
  LuTriangleAlert,
} from 'react-icons/lu';

type ConnectionData = {
  server_url?: string;
  k8s_version?: string;
  k8s_platform?: string;
  node_count?: number;
  api_groups?: number;
  last_checked?: string;
};

type KubeResource = Record<string, any>;

type Props = {
  data: ConnectionData | undefined;
  loading?: boolean;
  nodes: KubeResource[];
  pods: KubeResource[];
  events: KubeResource[];
};

function formatLastChecked(timestamp: string | undefined): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (date.toString() === 'Invalid Date') return '-';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const empty = value === '-';
  return (
    <Stack direction='row' alignItems='center' gap={0.5}>
      <Box sx={{ display: 'flex', color: 'text.tertiary' }}>{icon}</Box>
      <Typography level='body-xs' fontWeight={600} noWrap>
        {label}
      </Typography>
      <Typography
        level='body-xs'
        noWrap
        sx={{
          color: empty ? 'text.tertiary' : 'text.secondary',
          fontStyle: empty ? 'italic' : undefined,
        }}
      >
        {empty ? 'N/A' : value}
      </Typography>
    </Stack>
  );
}

function useHealthStatus(nodes: KubeResource[], pods: KubeResource[], events: KubeResource[]) {
  return React.useMemo(() => {
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
}

const ClusterInfoCard: React.FC<Props> = ({ data, loading, nodes, pods, events }) => {
  const health = useHealthStatus(nodes, pods, events);

  if (loading) {
    return (
      <Stack direction='row' alignItems='center' gap={1} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
        <CircularProgress size='sm' />
      </Stack>
    );
  }

  const healthColor = health.issues.length === 0 ? 'success' : health.hasErrors ? 'danger' : 'warning';
  const HealthIcon = health.issues.length === 0 ? LuCircleCheck : health.hasErrors ? LuCircleX : LuTriangleAlert;

  return (
    <Stack
      direction='row'
      alignItems='center'
      justifyContent='space-between'
      sx={{
        py: 0.75,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Left: cluster info + stats with dividers */}
      <Stack
        direction='row'
        alignItems='center'
        divider={<Divider orientation='vertical' />}
        gap={1.5}
        sx={{ minWidth: 0 }}
      >
        <StatItem icon={<LuGlobe size={12} />} label='Cluster' value={data?.server_url ?? '-'} />
        <StatItem icon={<LuTag size={12} />} label='Version' value={String(data?.k8s_version ?? '-')} />
        <StatItem icon={<LuCpu size={12} />} label='Platform' value={String(data?.k8s_platform ?? '-')} />
        <StatItem icon={<LuServer size={12} />} label='Nodes' value={data?.node_count != null ? String(data.node_count) : '-'} />
        <StatItem icon={<LuLayers size={12} />} label='APIs' value={data?.api_groups != null ? String(data.api_groups) : '-'} />
        <StatItem icon={<LuRefreshCw size={12} />} label='Checked' value={formatLastChecked(data?.last_checked)} />
      </Stack>

      {/* Right: health chip */}
      <Chip
        size='sm'
        variant='soft'
        color={healthColor}
        startDecorator={<HealthIcon size={12} />}
        sx={{ flexShrink: 0, ml: 1.5 }}
      >
        {health.issues.length === 0
          ? 'Healthy'
          : health.issues.join(' · ')}
      </Chip>
    </Stack>
  );
};

export default ClusterInfoCard;
