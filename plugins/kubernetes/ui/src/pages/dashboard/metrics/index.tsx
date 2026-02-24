import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Stack } from '@omniviewdev/ui/layout';
import { MetricsPanel } from '@omniviewdev/ui/charts';
import type { TimeSeriesDef, ChartTimeRange, MetricFormat, ChartAnnotation } from '@omniviewdev/ui/charts';
import { useResourceMetrics } from '@omniviewdev/runtime';
import type { metric } from '@omniviewdev/runtime/models';
import {
  LuCpu,
  LuMemoryStick,
  LuNetwork,
  LuHardDrive,
  LuActivity,
  LuRotateCcw,
  LuTriangleAlert,
} from 'react-icons/lu';

import { useClusterPreferences } from '../../../hooks/useClusterPreferences';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  'var(--ov-accent, #3b82f6)',
  'var(--ov-accent-secondary, #8b5cf6)',
  '#22c55e',
  '#f97316',
  '#ef4444',
];

function formatCores(v: number | null): string {
  if (v == null) return '–';
  if (v === 0) return '0 cores';
  if (Math.abs(v) < 0.01) return `${(v * 1000).toFixed(1)}m`;
  if (Math.abs(v) < 1) return `${v.toFixed(3)} cores`;
  return `${v.toFixed(2)} cores`;
}

function extractTimeSeries(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, metric.TimeSeries> {
  const out = new Map<string, metric.TimeSeries>();
  if (!data) return out;
  for (const resp of Object.values(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.time_series?.metric_id) {
        out.set(result.time_series.metric_id, result.time_series);
      }
    }
  }
  return out;
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

function toTimeSeriesDef(
  ts: metric.TimeSeries,
  label: string,
  color: string,
  opts?: { area?: boolean; lineStyle?: 'solid' | 'dashed' | 'dotted' },
): TimeSeriesDef {
  return {
    id: ts.metric_id,
    label,
    data: (ts.data_points ?? []).map((dp) => ({
      timestamp: new Date(String(dp.timestamp)).getTime(),
      value: dp.value,
    })),
    color,
    area: opts?.area ?? true,
    lineStyle: opts?.lineStyle,
  };
}

// ---------------------------------------------------------------------------
// Chart definitions
// ---------------------------------------------------------------------------

const ICON_SIZE = 13;

interface ChartDef {
  title: string;
  icon: React.ReactNode;
  metricIDs: string[];
  labels: Record<string, string>;
  colors: Record<string, string>;
  valueFormat: MetricFormat;
  valueFormatter?: (v: number | null) => string;
  unit?: string;
  annotationMetricIDs?: string[];
  annotationLabels?: Record<string, string>;
  seriesStyles?: Record<string, { area?: boolean; lineStyle?: 'solid' | 'dashed' | 'dotted' }>;
}

const METRICS_CHARTS: ChartDef[] = [
  {
    title: 'CPU: Usage vs Requests vs Capacity',
    icon: <LuCpu size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_cpu_usage_cores', 'prom_cluster_cpu_requests_pct'],
    labels: {
      prom_cluster_cpu_usage_cores: 'Usage (cores)',
      prom_cluster_cpu_requests_pct: 'Requests %',
    },
    colors: {
      prom_cluster_cpu_usage_cores: CHART_COLORS[0],
      prom_cluster_cpu_requests_pct: CHART_COLORS[3],
    },
    seriesStyles: {
      prom_cluster_cpu_requests_pct: { area: false, lineStyle: 'dashed' },
    },
    valueFormat: 'number',
    valueFormatter: formatCores,
    annotationMetricIDs: ['prom_cluster_cpu_cores'],
    annotationLabels: { prom_cluster_cpu_cores: 'Capacity' },
  },
  {
    title: 'Memory: Usage vs Requests vs Capacity',
    icon: <LuMemoryStick size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_memory_usage', 'prom_cluster_memory_requests_pct'],
    labels: {
      prom_cluster_memory_usage: 'Usage',
      prom_cluster_memory_requests_pct: 'Requests %',
    },
    colors: {
      prom_cluster_memory_usage: CHART_COLORS[1],
      prom_cluster_memory_requests_pct: CHART_COLORS[3],
    },
    seriesStyles: {
      prom_cluster_memory_requests_pct: { area: false, lineStyle: 'dashed' },
    },
    valueFormat: 'bytes',
    annotationMetricIDs: ['prom_cluster_memory_total'],
    annotationLabels: { prom_cluster_memory_total: 'Total' },
  },
  {
    title: 'Resource Requests %',
    icon: <LuCpu size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_cpu_requests_pct', 'prom_cluster_memory_requests_pct'],
    labels: {
      prom_cluster_cpu_requests_pct: 'CPU Requests %',
      prom_cluster_memory_requests_pct: 'Memory Requests %',
    },
    colors: {
      prom_cluster_cpu_requests_pct: CHART_COLORS[0],
      prom_cluster_memory_requests_pct: CHART_COLORS[1],
    },
    valueFormat: 'percent',
  },
  {
    title: 'Container Restarts',
    icon: <LuRotateCcw size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_container_restarts'],
    labels: { prom_cluster_container_restarts: 'Restart Rate' },
    colors: { prom_cluster_container_restarts: '#ef4444' },
    valueFormat: 'rate',
  },
  {
    title: 'OOM Events',
    icon: <LuTriangleAlert size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_oom_events'],
    labels: { prom_cluster_oom_events: 'OOM Rate' },
    colors: { prom_cluster_oom_events: '#f97316' },
    valueFormat: 'rate',
  },
  {
    title: 'Disk I/O',
    icon: <LuHardDrive size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_disk_read_rate', 'prom_cluster_disk_write_rate'],
    labels: {
      prom_cluster_disk_read_rate: 'Read',
      prom_cluster_disk_write_rate: 'Write',
    },
    colors: {
      prom_cluster_disk_read_rate: '#22c55e',
      prom_cluster_disk_write_rate: '#f97316',
    },
    valueFormat: 'bytes',
    unit: '/s',
  },
  {
    title: 'Network I/O',
    icon: <LuNetwork size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_network_receive_rate', 'prom_cluster_network_transmit_rate'],
    labels: {
      prom_cluster_network_receive_rate: 'Receive',
      prom_cluster_network_transmit_rate: 'Transmit',
    },
    colors: {
      prom_cluster_network_receive_rate: '#22c55e',
      prom_cluster_network_transmit_rate: CHART_COLORS[0],
    },
    valueFormat: 'bytes',
    unit: '/s',
  },
  {
    title: 'Load Average',
    icon: <LuActivity size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_load1', 'prom_cluster_load5', 'prom_cluster_load15'],
    labels: {
      prom_cluster_load1: '1m',
      prom_cluster_load5: '5m',
      prom_cluster_load15: '15m',
    },
    colors: {
      prom_cluster_load1: CHART_COLORS[0],
      prom_cluster_load5: CHART_COLORS[1],
      prom_cluster_load15: '#22c55e',
    },
    valueFormat: 'number',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ClusterDashboardMetricsPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [timeRange, setTimeRange] = React.useState<ChartTimeRange>({
    from: new Date(Date.now() - 3600000),
    to: new Date(),
  });

  const { connectionOverrides } = useClusterPreferences('kubernetes');
  const metricConfig = connectionOverrides[id]?.metricConfig;

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

  // All time-series metric IDs
  const tsMetricIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const chart of METRICS_CHARTS) {
      for (const mid of chart.metricIDs) ids.add(mid);
    }
    return [...ids];
  }, []);

  // All annotation (instant) metric IDs
  const annotationMetricIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const chart of METRICS_CHARTS) {
      if (chart.annotationMetricIDs) {
        for (const mid of chart.annotationMetricIDs) ids.add(mid);
      }
    }
    return [...ids];
  }, []);

  // Time-series data
  const { data: tsData, providers, isLoading } = useResourceMetrics({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'cluster::metrics',
    resourceID: '',
    resourceData,
    shape: 1,
    timeRange: {
      start: timeRange.from,
      end: timeRange.to,
      step: '',
    },
    metricIDs: tsMetricIDs,
    refreshInterval: 30000,
  });

  // Instant data for annotations
  const { data: instantData } = useResourceMetrics({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'cluster::metrics',
    resourceID: '',
    resourceData,
    shape: 0,
    metricIDs: annotationMetricIDs,
    refreshInterval: 30000,
    enabled: annotationMetricIDs.length > 0,
  });

  const tsSeries = useMemo(() => extractTimeSeries(tsData), [tsData]);
  const instantValues = useMemo(() => extractCurrentValues(instantData), [instantData]);

  if (providers.length === 0 && !isLoading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No metric providers available. Ensure Prometheus is running in your cluster.
        </Typography>
      </Box>
    );
  }

  const activeCharts = METRICS_CHARTS.filter((def) =>
    def.metricIDs.some((mid) => tsSeries.has(mid)),
  );

  return (
    <Box sx={{ p: 1.5, overflow: 'auto', height: '100%', width: '100%', flex: 1 }}>
      <Stack gap={1.5}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 1.5,
          }}
        >
          {(isLoading && activeCharts.length === 0 ? METRICS_CHARTS : activeCharts).map((def) => {
            const series: TimeSeriesDef[] = [];
            for (const mid of def.metricIDs) {
              const ts = tsSeries.get(mid);
              if (!ts) continue;
              const style = def.seriesStyles?.[mid];
              series.push(
                toTimeSeriesDef(
                  ts,
                  def.labels[mid] || mid,
                  def.colors[mid] || CHART_COLORS[series.length % CHART_COLORS.length],
                  style,
                ),
              );
            }

            const annotations: ChartAnnotation[] = [];
            if (def.annotationMetricIDs) {
              for (const amid of def.annotationMetricIDs) {
                const val = instantValues.get(amid);
                if (val != null && val > 0) {
                  annotations.push({
                    value: val,
                    label: def.annotationLabels?.[amid] ?? amid,
                    color: 'var(--ov-fg-muted, #888)',
                    lineStyle: 'dashed',
                  });
                }
              }
            }

            return (
              <MetricsPanel
                key={def.title}
                title={def.title}
                icon={def.icon}
                series={series}
                timeRange={timeRange}
                onTimeRangeChange={setTimeRange}
                valueFormat={def.valueFormat}
                valueFormatter={def.valueFormatter}
                unit={def.unit}
                annotations={annotations.length > 0 ? annotations : undefined}
                area
                variant="default"
                height={220}
                loading={isLoading && series.length === 0}
              />
            );
          })}
        </Box>
      </Stack>
    </Box>
  );
};

export default ClusterDashboardMetricsPage;
