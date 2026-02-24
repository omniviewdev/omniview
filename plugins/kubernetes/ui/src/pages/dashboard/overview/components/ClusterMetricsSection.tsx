import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import { useResourceMetrics } from '@omniviewdev/runtime';
import type { metric } from '@omniviewdev/runtime/models';
import { MetricsPanel } from '@omniviewdev/ui/charts';
import type { TimeSeriesDef, ChartTimeRange, MetricFormat, ChartAnnotation } from '@omniviewdev/ui/charts';
import { LuCpu, LuMemoryStick, LuNetwork, LuHardDrive, LuActivity, LuRotateCcw } from 'react-icons/lu';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClusterMetricsSectionProps {
  connectionID: string;
  /** First selected namespace, or empty string for cluster-wide */
  namespace: string;
  /** Time range for charts */
  timeRange: ChartTimeRange;
  onTimeRangeChange: (range: ChartTimeRange) => void;
  /** Per-connection Prometheus config override */
  metricConfig?: {
    prometheusService?: string;
    prometheusNamespace?: string;
    prometheusPort?: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  'var(--ov-accent, #3b82f6)',
  'var(--ov-accent-secondary, #8b5cf6)',
  '#22c55e',
  '#f97316',
];

function formatCores(v: number | null): string {
  if (v == null) return '–';
  if (v === 0) return '0 cores';
  if (Math.abs(v) < 0.01) return `${(v * 1000).toFixed(1)}m`;
  if (Math.abs(v) < 0.1) return `${(v * 1000).toFixed(0)}m`;
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
  opts?: { lineStyle?: 'solid' | 'dashed' | 'dotted'; area?: boolean },
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

interface ChartDef {
  title: string;
  icon: React.ReactNode;
  metricIDs: string[];
  labels: Record<string, string>;
  colors: Record<string, string>;
  valueFormat: MetricFormat;
  valueFormatter?: (v: number | null) => string;
  unit?: string;
  /** Metric IDs for capacity annotation lines (fetched via instant query) */
  annotationMetricIDs?: string[];
  annotationLabels?: Record<string, string>;
  /** Override area/lineStyle per series */
  seriesStyles?: Record<string, { area?: boolean; lineStyle?: 'solid' | 'dashed' | 'dotted' }>;
}

const ICON_SIZE = 13;

const CLUSTER_CHARTS: ChartDef[] = [
  {
    title: 'CPU Usage',
    icon: <LuCpu size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_cpu_usage_cores'],
    labels: { prom_cluster_cpu_usage_cores: 'Used (cores)' },
    colors: { prom_cluster_cpu_usage_cores: CHART_COLORS[0] },
    valueFormat: 'number',
    valueFormatter: formatCores,
    annotationMetricIDs: ['prom_cluster_cpu_cores'],
    annotationLabels: { prom_cluster_cpu_cores: 'Capacity' },
  },
  {
    title: 'Memory Usage',
    icon: <LuMemoryStick size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_memory_usage'],
    labels: { prom_cluster_memory_usage: 'Used' },
    colors: { prom_cluster_memory_usage: CHART_COLORS[1] },
    valueFormat: 'bytes',
    annotationMetricIDs: ['prom_cluster_memory_total'],
    annotationLabels: { prom_cluster_memory_total: 'Total' },
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
    title: 'Filesystem Usage',
    icon: <LuHardDrive size={ICON_SIZE} />,
    metricIDs: ['prom_cluster_fs_usage_pct'],
    labels: { prom_cluster_fs_usage_pct: 'Used %' },
    colors: { prom_cluster_fs_usage_pct: CHART_COLORS[1] },
    valueFormat: 'percent',
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

const NAMESPACE_CHARTS: ChartDef[] = [
  {
    title: 'Workload CPU',
    icon: <LuCpu size={ICON_SIZE} />,
    metricIDs: ['prom_namespace_cpu_usage'],
    labels: { prom_namespace_cpu_usage: 'CPU Usage' },
    colors: { prom_namespace_cpu_usage: CHART_COLORS[0] },
    valueFormat: 'number',
    valueFormatter: formatCores,
  },
  {
    title: 'Workload Memory',
    icon: <LuMemoryStick size={ICON_SIZE} />,
    metricIDs: ['prom_namespace_memory_usage'],
    labels: { prom_namespace_memory_usage: 'Memory Usage' },
    colors: { prom_namespace_memory_usage: CHART_COLORS[1] },
    valueFormat: 'bytes',
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
    title: 'Container Restarts',
    icon: <LuRotateCcw size={ICON_SIZE} />,
    metricIDs: ['prom_namespace_container_restarts'],
    labels: { prom_namespace_container_restarts: 'Restart Rate' },
    colors: { prom_namespace_container_restarts: '#ef4444' },
    valueFormat: 'rate',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ClusterMetricsSection: React.FC<ClusterMetricsSectionProps> = ({
  connectionID,
  namespace,
  timeRange,
  onTimeRangeChange,
  metricConfig,
}) => {
  const charts = namespace ? NAMESPACE_CHARTS : CLUSTER_CHARTS;

  // All metric IDs needed for the time-series query
  const tsMetricIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const chart of charts) {
      for (const id of chart.metricIDs) ids.add(id);
    }
    return [...ids];
  }, [charts]);

  // Annotation metric IDs (instant query for capacity lines)
  const annotationMetricIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const chart of charts) {
      if (chart.annotationMetricIDs) {
        for (const id of chart.annotationMetricIDs) ids.add(id);
      }
    }
    return [...ids];
  }, [charts]);

  // Build resourceData with optional Prometheus config override
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

  // Time-series query (shape=1)
  const { data: tsData, providers, isLoading } = useResourceMetrics({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'cluster::metrics',
    resourceID: '',
    resourceNamespace: namespace,
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

  // Instant query for annotation values (capacity lines)
  const { data: instantData } = useResourceMetrics({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'cluster::metrics',
    resourceID: '',
    resourceNamespace: namespace,
    resourceData,
    shape: 0,
    metricIDs: annotationMetricIDs,
    refreshInterval: 30000,
    enabled: annotationMetricIDs.length > 0,
  });

  const tsSeries = useMemo(() => extractTimeSeries(tsData), [tsData]);
  const instantValues = useMemo(() => extractCurrentValues(instantData), [instantData]);

  // Don't render anything if no providers or no data available
  if (providers.length === 0 && !isLoading) return null;

  // Only show charts that have data
  const activeCharts = charts.filter((def) =>
    def.metricIDs.some((id) => tsSeries.has(id)),
  );

  if (activeCharts.length === 0 && !isLoading) return null;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 1.5,
      }}
    >
      {(isLoading && activeCharts.length === 0 ? charts : activeCharts).map((def) => {
        const series: TimeSeriesDef[] = [];
        for (const id of def.metricIDs) {
          const ts = tsSeries.get(id);
          if (!ts) continue;
          const style = def.seriesStyles?.[id];
          series.push(
            toTimeSeriesDef(
              ts,
              def.labels[id] || id,
              def.colors[id] || CHART_COLORS[series.length % CHART_COLORS.length],
              style,
            ),
          );
        }

        // Build annotations from instant capacity values
        const annotations: ChartAnnotation[] = [];
        if (def.annotationMetricIDs) {
          for (const id of def.annotationMetricIDs) {
            const val = instantValues.get(id);
            if (val != null && val > 0) {
              annotations.push({
                value: val,
                label: def.annotationLabels?.[id] ?? id,
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
            onTimeRangeChange={onTimeRangeChange}
            valueFormat={def.valueFormat}
            valueFormatter={def.valueFormatter}
            unit={def.unit}
            annotations={annotations.length > 0 ? annotations : undefined}
            area
            variant="default"
            height={180}
            loading={isLoading && series.length === 0}
          />
        );
      })}
    </Box>
  );
};

export default ClusterMetricsSection;
