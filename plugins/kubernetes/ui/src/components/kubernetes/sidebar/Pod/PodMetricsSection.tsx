import React, { useState, useMemo, useCallback } from "react";

import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import CircularProgress from "@mui/material/CircularProgress";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import { useResourceMetrics } from "@omniviewdev/runtime";
import { metric } from "@omniviewdev/runtime/models";
import { MetricsPanel } from "@omniviewdev/ui/charts";
import type { TimeSeriesDef, ChartTimeRange } from "@omniviewdev/ui/charts";

interface Props {
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  resourceNamespace: string;
  resourceData?: Record<string, unknown>;
}

function formatValue(value: number, unitCode: number): string {
  if (unitCode === 1) {
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if (unitCode === 10) {
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
    return `${value.toFixed(0)} B/s`;
  }
  if (unitCode === 11) {
    if (value >= 1000) return `${(value / 1000).toFixed(2)} cores`;
    return `${Math.round(value)}m`;
  }
  if (unitCode === 12) return `${value.toFixed(3)} cores`;
  if (unitCode === 5) return `${value.toFixed(1)}%`;
  if (Number.isInteger(value)) return `${value}`;
  return `${value.toFixed(2)}`;
}

/** Compact metric tile for instant values */
const MetricTile: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <Box
    sx={{
      py: 0.75,
      px: 1,
      borderRadius: 1,
      border: "1px solid",
      borderColor: "divider",
      bgcolor: "background.level1",
    }}
  >
    <Text size="xs" sx={{ color: "neutral.400", mb: 0.25, display: "block" }}>
      {label}
    </Text>
    <Text size="sm" weight="semibold" sx={{ fontVariantNumeric: "tabular-nums" }}>
      {value}
    </Text>
  </Box>
);

/** Readable display name for known metric IDs */
const METRIC_NAMES: Record<string, string> = {
  cpu_usage: "CPU (metrics-server)",
  memory_usage: "Memory (metrics-server)",
  prom_cpu_usage_rate: "CPU Usage Rate",
  prom_cpu_throttle_rate: "CPU Throttle",
  prom_memory_working_set: "Working Set",
  prom_memory_rss: "RSS",
  prom_network_receive_rate: "Receive",
  prom_network_transmit_rate: "Transmit",
  prom_fs_usage: "Filesystem Usage",
  prom_restart_count: "Restarts",
};

/** Extract current-value metrics from all providers keyed by metric_id */
function extractCurrentMetrics(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, { value: number; unit: number }> {
  const out = new Map<string, { value: number; unit: number }>();
  if (!data) return out;

  for (const [, resp] of Object.entries(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.current_value) {
        out.set(result.current_value.metric_id, {
          value: result.current_value.value,
          unit: 0,
        });
      }
    }
  }
  return out;
}

/** Extract time-series results keyed by metric_id */
function extractTimeSeries(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, metric.TimeSeries> {
  const out = new Map<string, metric.TimeSeries>();
  if (!data) return out;

  for (const [, resp] of Object.entries(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.time_series) {
        out.set(result.time_series.metric_id, result.time_series);
      }
    }
  }
  return out;
}

/** Convert SDK TimeSeries to chart-compatible TimeSeriesDef */
function toTimeSeriesDef(
  ts: metric.TimeSeries,
  label: string,
  color?: string,
): TimeSeriesDef {
  return {
    id: ts.metric_id,
    label,
    // dp.timestamp is a Wails-serialized time.Time (ISO string at runtime)
    data: (ts.data_points ?? []).map((dp) => ({
      timestamp: new Date(String(dp.timestamp)).getTime(),
      value: dp.value,
    })),
    color,
    area: true,
  };
}

/** Metrics that remain as instant-only tiles */
const TILE_ONLY_METRICS = [
  "cpu_usage",
  "memory_usage",
  "prom_fs_usage",
  "prom_cpu_throttle_rate",
  "prom_restart_count",
];

const PodMetricsSection: React.FC<Props> = ({
  connectionID,
  resourceKey,
  resourceID,
  resourceNamespace,
  resourceData,
}) => {
  const [timeRange, setTimeRange] = useState<ChartTimeRange>({
    from: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    to: new Date(),
  });

  // Instant values (shape=0 CURRENT) for tiles and current value annotations
  const { data: currentData, isLoading: currentLoading, error } = useResourceMetrics({
    pluginID: "kubernetes",
    connectionID,
    resourceKey,
    resourceID,
    resourceNamespace,
    resourceData,
    refreshInterval: 30000,
  });

  // Time-series data (shape=1 TIMESERIES) for charts
  const { data: tsData, isLoading: tsLoading } = useResourceMetrics({
    pluginID: "kubernetes",
    connectionID,
    resourceKey,
    resourceID,
    resourceNamespace,
    resourceData,
    shape: 1,
    timeRange: {
      start: timeRange.from,
      end: timeRange.to,
      step: "",
    },
    metricIDs: [
      "prom_cpu_usage_rate",
      "prom_memory_working_set",
      "prom_memory_rss",
      "prom_network_receive_rate",
      "prom_network_transmit_rate",
    ],
    refreshInterval: 30000,
  });

  const currentMetrics = useMemo(() => extractCurrentMetrics(currentData), [currentData]);
  const tsSeries = useMemo(() => extractTimeSeries(tsData), [tsData]);

  const isLoading = currentLoading && currentMetrics.size === 0;
  const hasTimeSeries = tsSeries.size > 0;

  // Build chart series
  const cpuSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const cpu = tsSeries.get("prom_cpu_usage_rate");
    if (cpu) s.push(toTimeSeriesDef(cpu, "CPU Usage", "var(--ov-accent)"));
    return s;
  }, [tsSeries]);

  const memorySeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const ws = tsSeries.get("prom_memory_working_set");
    if (ws) s.push(toTimeSeriesDef(ws, "Working Set", "var(--ov-accent)"));
    const rss = tsSeries.get("prom_memory_rss");
    if (rss) s.push(toTimeSeriesDef(rss, "RSS", "var(--ov-accent-secondary, #8b5cf6)"));
    return s;
  }, [tsSeries]);

  const networkSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const rx = tsSeries.get("prom_network_receive_rate");
    if (rx) s.push(toTimeSeriesDef(rx, "Receive", "#22c55e"));
    const tx = tsSeries.get("prom_network_transmit_rate");
    if (tx) s.push(toTimeSeriesDef(tx, "Transmit", "#f97316"));
    return s;
  }, [tsSeries]);

  const handleTimeRangeChange = useCallback((range: ChartTimeRange) => {
    setTimeRange(range);
  }, []);

  // Tile-only metrics
  const tileMetrics = TILE_ONLY_METRICS
    .filter((id) => currentMetrics.has(id))
    .map((id) => ({ id, ...currentMetrics.get(id)! }));

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (currentMetrics.size === 0 && !hasTimeSeries && !error) {
    return (
      <Box
        sx={{
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ py: 0.5, px: 1 }}>
          <Text weight="semibold" size="sm">Metrics</Text>
        </Box>
        <Box sx={{ px: 1, pb: 1 }}>
          <Text size="xs" sx={{ color: "neutral.500" }}>
            No metrics available. Ensure metrics-server or Prometheus is installed.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          py: 0.5,
          px: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text weight="semibold" size="sm">Metrics</Text>
        {(currentLoading || tsLoading) && <CircularProgress size={12} />}
      </Box>

      {error && (
        <Box sx={{ px: 1, pb: 0.5 }}>
          <Text size="xs" sx={{ color: "danger.400" }}>
            {error.message || "Failed to load metrics"}
          </Text>
        </Box>
      )}

      <Box sx={{ px: 0.5, pb: 1 }}>
        <Stack spacing={0.75}>
          {/* Time-series charts */}
          {hasTimeSeries && (
            <>
              {cpuSeries.length > 0 && (
                <MetricsPanel
                  title="CPU"
                  series={cpuSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="rate"
                  unit="cores"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {memorySeries.length > 0 && (
                <MetricsPanel
                  title="Memory"
                  series={memorySeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="bytes"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {networkSeries.length > 0 && (
                <MetricsPanel
                  title="Network"
                  series={networkSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="bytes"
                  unit="/s"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
            </>
          )}

          {/* Instant-only tiles */}
          {tileMetrics.length > 0 && (
            <Box sx={{ px: 0.5 }}>
              <Text
                size="xs"
                weight="semibold"
                sx={{
                  color: "neutral.400",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  fontSize: "0.6rem",
                  mb: 0.5,
                }}
              >
                Current Values
              </Text>
              <Grid container spacing={0.5}>
                {tileMetrics.map((m) => (
                  <Grid key={m.id} size={6}>
                    <MetricTile
                      label={METRIC_NAMES[m.id] || m.id}
                      value={formatValue(m.value, m.unit)}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}
        </Stack>
      </Box>
    </Box>
  );
};

export default PodMetricsSection;
