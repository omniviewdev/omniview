import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import { useResourceMetrics } from '@omniviewdev/runtime';
import type { metric } from '@omniviewdev/runtime/models';
import { LuCpu, LuMemoryStick, LuBox, LuHardDrive } from 'react-icons/lu';

interface ClusterResourceGaugesProps {
  connectionID: string;
  metricConfig?: {
    prometheusService?: string;
    prometheusNamespace?: string;
    prometheusPort?: number;
  };
}

function extractCurrentValues(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!data) return out;
  for (const resp of Object.values(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.current_value?.metric_id) {
        out.set(result.current_value.metric_id, result.current_value.value ?? 0);
      }
    }
  }
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
}

function formatCores(cores: number): string {
  if (cores < 0.01) return `${(cores * 1000).toFixed(0)}m`;
  if (cores < 1) return `${cores.toFixed(2)}`;
  return `${cores.toFixed(1)}`;
}

interface GaugeItem {
  label: string;
  icon: React.ReactNode;
  pct: number;
  primary: string;
  secondary: string;
}

const GAUGE_METRIC_IDS = [
  'prom_cluster_cpu_utilization',
  'prom_cluster_cpu_cores',
  'prom_cluster_memory_utilization',
  'prom_cluster_memory_total',
  'prom_cluster_pod_count',
  'prom_cluster_pod_capacity',
  'prom_cluster_fs_usage_pct',
  'prom_cluster_fs_total',
];

const ClusterResourceGauges: React.FC<ClusterResourceGaugesProps> = ({
  connectionID,
  metricConfig,
}) => {
  const resourceData = useMemo(() => {
    if (!metricConfig?.prometheusService && !metricConfig?.prometheusNamespace && !metricConfig?.prometheusPort) {
      return {};
    }
    return {
      __metric_config__: {
        service: metricConfig.prometheusService || '',
        namespace: metricConfig.prometheusNamespace || '',
        port: metricConfig.prometheusPort || 0,
      },
    };
  }, [metricConfig]);

  const { data, providers, isLoading } = useResourceMetrics({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'cluster::metrics',
    resourceID: '',
    resourceData,
    shape: 0,
    metricIDs: GAUGE_METRIC_IDS,
    refreshInterval: 30000,
  });

  const values = useMemo(() => extractCurrentValues(data), [data]);

  if (providers.length === 0 && !isLoading) return null;
  if (values.size === 0 && !isLoading) return null;

  const cpuPct = values.get('prom_cluster_cpu_utilization') ?? 0;
  const cpuCores = values.get('prom_cluster_cpu_cores') ?? 0;
  const memPct = values.get('prom_cluster_memory_utilization') ?? 0;
  const memTotal = values.get('prom_cluster_memory_total') ?? 0;
  const podCount = values.get('prom_cluster_pod_count') ?? 0;
  const podCap = values.get('prom_cluster_pod_capacity') ?? 0;
  const fsPct = values.get('prom_cluster_fs_usage_pct') ?? 0;
  const fsTotal = values.get('prom_cluster_fs_total') ?? 0;

  const podPct = podCap > 0 ? (podCount / podCap) * 100 : 0;

  const gauges: GaugeItem[] = [
    {
      label: 'CPU',
      icon: <LuCpu size={14} />,
      pct: cpuPct,
      primary: `${cpuPct.toFixed(1)}%`,
      secondary: `${formatCores(cpuCores * cpuPct / 100)}/${formatCores(cpuCores)} cores`,
    },
    {
      label: 'Memory',
      icon: <LuMemoryStick size={14} />,
      pct: memPct,
      primary: `${memPct.toFixed(1)}%`,
      secondary: `${formatBytes(memTotal * memPct / 100)}/${formatBytes(memTotal)}`,
    },
    {
      label: 'Pods',
      icon: <LuBox size={14} />,
      pct: podPct,
      primary: `${Math.round(podCount)}/${Math.round(podCap)}`,
      secondary: `${podPct.toFixed(0)}% used`,
    },
    {
      label: 'Disk',
      icon: <LuHardDrive size={14} />,
      pct: fsPct,
      primary: `${fsPct.toFixed(1)}%`,
      secondary: `${formatBytes(fsTotal * fsPct / 100)}/${formatBytes(fsTotal)}`,
    },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1.5,
      }}
    >
      {gauges.map((g) => (
        <GaugeStatCard key={g.label} {...g} loading={isLoading && values.size === 0} />
      ))}
    </Box>
  );
};

function pctColor(pct: number): string {
  if (pct < 60) return 'var(--ov-palette-success-main, #22c55e)';
  if (pct < 85) return 'var(--ov-palette-warning-main, #f59e0b)';
  return 'var(--ov-palette-error-main, #ef4444)';
}

function GaugeStatCard({
  label,
  icon,
  pct,
  primary,
  secondary,
  loading,
}: GaugeItem & { loading: boolean }) {
  if (loading) {
    return (
      <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="rectangular" height={4} sx={{ mt: 1, borderRadius: 1 }} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.03em', fontSize: '0.65rem' }}>
          {label}
        </Typography>
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
        {primary}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
        {secondary}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={Math.min(pct, 100)}
        sx={{
          mt: 1,
          height: 4,
          borderRadius: 2,
          bgcolor: 'action.hover',
          '& .MuiLinearProgress-bar': {
            bgcolor: pctColor(pct),
            borderRadius: 2,
          },
        }}
      />
    </Box>
  );
}

export default ClusterResourceGauges;
