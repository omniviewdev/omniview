import React, { useState, useMemo, useCallback } from "react";

import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
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
  resourceData?: Record<string, unknown>;
}

/** Extract current-value metrics keyed by metric_id */
function extractCurrentMetrics(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!data) return out;

  for (const [, resp] of Object.entries(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.current_value) {
        out.set(result.current_value.metric_id, result.current_value.value);
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

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatBytesPerSec(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

/** Percentage gauge with label and bar */
const PercentGauge: React.FC<{
  label: string;
  value: number;
  subtitle?: string;
}> = ({ label, value, subtitle }) => {
  const color = value >= 90 ? "error" : value >= 70 ? "warning" : "primary";

  return (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="baseline"
        sx={{ mb: 0.25 }}
      >
        <Text size="xs" sx={{ color: "neutral.400" }}>
          {label}
        </Text>
        <Text
          size="xs"
          weight="semibold"
          sx={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value.toFixed(1)}%
        </Text>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(value, 100)}
        color={color}
        sx={{ height: 4, borderRadius: 2 }}
      />
      {subtitle && (
        <Text
          size="xs"
          sx={{ color: "neutral.500", fontSize: "0.6rem", mt: 0.25 }}
        >
          {subtitle}
        </Text>
      )}
    </Box>
  );
};

/** Compact stat tile */
const StatTile: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <Box
    sx={{
      py: 0.5,
      px: 1,
      borderRadius: 1,
      border: "1px solid",
      borderColor: "divider",
      bgcolor: "background.level1",
    }}
  >
    <Text size="xs" sx={{ color: "neutral.400", display: "block", mb: 0.25 }}>
      {label}
    </Text>
    <Text size="sm" weight="semibold" sx={{ fontVariantNumeric: "tabular-nums" }}>
      {value}
    </Text>
  </Box>
);

const NodeMetricsSection: React.FC<Props> = ({
  connectionID,
  resourceKey,
  resourceID,
  resourceData,
}) => {
  const [timeRange, setTimeRange] = useState<ChartTimeRange>({
    from: new Date(Date.now() - 60 * 60 * 1000),
    to: new Date(),
  });

  // Instant values (shape=0 CURRENT)
  const { data: currentData, isLoading: currentLoading, error } = useResourceMetrics({
    pluginID: "kubernetes",
    connectionID,
    resourceKey,
    resourceID,
    resourceData,
    refreshInterval: 30000,
  });

  // Time-series data (shape=1 TIMESERIES)
  const { data: tsData, isLoading: tsLoading } = useResourceMetrics({
    pluginID: "kubernetes",
    connectionID,
    resourceKey,
    resourceID,
    resourceData,
    shape: 1,
    timeRange: {
      start: timeRange.from,
      end: timeRange.to,
      step: "",
    },
    metricIDs: [
      "prom_cpu_utilization",
      "prom_memory_utilization",
      "prom_network_receive_rate",
      "prom_network_transmit_rate",
      "prom_disk_utilization",
      "prom_load_avg_1m",
      "prom_load_avg_5m",
      "prom_load_avg_15m",
      "prom_pod_count",
      "prom_disk_read_rate",
      "prom_disk_write_rate",
      "prom_network_errors",
      "prom_context_switches",
    ],
    refreshInterval: 30000,
  });

  const metrics = useMemo(() => extractCurrentMetrics(currentData), [currentData]);
  const tsSeries = useMemo(() => extractTimeSeries(tsData), [tsData]);

  const isLoading = currentLoading && metrics.size === 0;
  const hasTimeSeries = tsSeries.size > 0;

  // Build chart series
  const cpuSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const cpu = tsSeries.get("prom_cpu_utilization");
    if (cpu) s.push(toTimeSeriesDef(cpu, "CPU Utilization", "var(--ov-accent)"));
    return s;
  }, [tsSeries]);

  const memorySeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const mem = tsSeries.get("prom_memory_utilization");
    if (mem) s.push(toTimeSeriesDef(mem, "Memory Utilization", "var(--ov-accent)"));
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

  const diskUtilSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const d = tsSeries.get("prom_disk_utilization");
    if (d) s.push(toTimeSeriesDef(d, "Disk Utilization", "#a855f7"));
    return s;
  }, [tsSeries]);

  const diskIOSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const r = tsSeries.get("prom_disk_read_rate");
    if (r) s.push(toTimeSeriesDef(r, "Read", "#22c55e"));
    const w = tsSeries.get("prom_disk_write_rate");
    if (w) s.push(toTimeSeriesDef(w, "Write", "#f97316"));
    return s;
  }, [tsSeries]);

  const loadAvgSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const l1 = tsSeries.get("prom_load_avg_1m");
    if (l1) s.push(toTimeSeriesDef(l1, "1m", "#3b82f6"));
    const l5 = tsSeries.get("prom_load_avg_5m");
    if (l5) s.push(toTimeSeriesDef(l5, "5m", "#f97316"));
    const l15 = tsSeries.get("prom_load_avg_15m");
    if (l15) s.push(toTimeSeriesDef(l15, "15m", "#a855f7"));
    return s;
  }, [tsSeries]);

  const podCountSeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const p = tsSeries.get("prom_pod_count");
    if (p) s.push(toTimeSeriesDef(p, "Pod Count", "var(--ov-accent)"));
    return s;
  }, [tsSeries]);

  const systemActivitySeries = useMemo<TimeSeriesDef[]>(() => {
    const s: TimeSeriesDef[] = [];
    const cs = tsSeries.get("prom_context_switches");
    if (cs) s.push(toTimeSeriesDef(cs, "Context Switches", "#3b82f6"));
    const ne = tsSeries.get("prom_network_errors");
    if (ne) s.push(toTimeSeriesDef(ne, "Network Errors", "#ef4444"));
    return s;
  }, [tsSeries]);

  const handleTimeRangeChange = useCallback((range: ChartTimeRange) => {
    setTimeRange(range);
  }, []);

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (metrics.size === 0 && !hasTimeSeries && !error) {
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

  // Extract known current metrics with defaults
  const cpuUsage = metrics.get("cpu_usage") ?? 0;
  const cpuUtilPct = metrics.get("prom_cpu_utilization");
  const memUsage = metrics.get("memory_usage") ?? 0;
  const memUtilPct = metrics.get("prom_memory_utilization");
  const memTotal = metrics.get("prom_memory_total");
  const diskUtilPct = metrics.get("prom_disk_utilization");
  const diskTotal = metrics.get("prom_disk_total");
  const netRx = metrics.get("prom_network_receive_rate");
  const netTx = metrics.get("prom_network_transmit_rate");
  const loadAvg = metrics.get("prom_load_avg_1m");
  const podCount = metrics.get("prom_pod_count");

  const hasPrometheus = cpuUtilPct !== undefined;

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
                  title="CPU Utilization"
                  series={cpuSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="percent"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {memorySeries.length > 0 && (
                <MetricsPanel
                  title="Memory Utilization"
                  series={memorySeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="percent"
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
              {diskUtilSeries.length > 0 && (
                <MetricsPanel
                  title="Disk Utilization"
                  series={diskUtilSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="percent"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {diskIOSeries.length > 0 && (
                <MetricsPanel
                  title="Disk I/O"
                  series={diskIOSeries}
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
              {loadAvgSeries.length > 0 && (
                <MetricsPanel
                  title="Load Average"
                  series={loadAvgSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="number"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {podCountSeries.length > 0 && (
                <MetricsPanel
                  title="Pod Count"
                  series={podCountSeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="number"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
              {systemActivitySeries.length > 0 && (
                <MetricsPanel
                  title="System Activity"
                  series={systemActivitySeries}
                  timeRange={timeRange}
                  onTimeRangeChange={handleTimeRangeChange}
                  valueFormat="number"
                  unit="/s"
                  area
                  variant="compact"
                  height={140}
                  loading={tsLoading}
                />
              )}
            </>
          )}

          {/* Utilization gauges (instant values) — shown when no charts available */}
          {hasPrometheus && !hasTimeSeries && (
            <Box sx={{ px: 0.5 }}>
              <Text
                size="xs"
                weight="semibold"
                sx={{
                  color: "neutral.400",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  fontSize: "0.6rem",
                  mb: 0.75,
                }}
              >
                Utilization
              </Text>
              <Stack spacing={0.75}>
                {cpuUtilPct !== undefined && (
                  <PercentGauge label="CPU" value={cpuUtilPct} />
                )}
                {memUtilPct !== undefined && (
                  <PercentGauge
                    label="Memory"
                    value={memUtilPct}
                    subtitle={memTotal !== undefined ? `of ${formatBytes(memTotal)}` : undefined}
                  />
                )}
                {diskUtilPct !== undefined && (
                  <PercentGauge
                    label="Disk"
                    value={diskUtilPct}
                    subtitle={diskTotal !== undefined ? `of ${formatBytes(diskTotal)}` : undefined}
                  />
                )}
              </Stack>
            </Box>
          )}

          {/* Metrics-server CPU/Memory */}
          {(cpuUsage > 0 || memUsage > 0) && (
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
                {hasPrometheus ? "Current Usage" : "Usage"}
              </Text>
              <Grid container spacing={0.5}>
                {cpuUsage > 0 && (
                  <Grid size={6}>
                    <StatTile
                      label="CPU"
                      value={
                        cpuUsage >= 1000
                          ? `${(cpuUsage / 1000).toFixed(2)} cores`
                          : `${Math.round(cpuUsage)}m`
                      }
                    />
                  </Grid>
                )}
                {memUsage > 0 && (
                  <Grid size={6}>
                    <StatTile label="Memory" value={formatBytes(memUsage)} />
                  </Grid>
                )}
              </Grid>
            </Box>
          )}

          {/* Network stats (instant, when no charts) */}
          {!hasTimeSeries && (netRx !== undefined || netTx !== undefined) && (
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
                Network
              </Text>
              <Grid container spacing={0.5}>
                {netRx !== undefined && (
                  <Grid size={6}>
                    <StatTile label="Receive" value={formatBytesPerSec(netRx)} />
                  </Grid>
                )}
                {netTx !== undefined && (
                  <Grid size={6}>
                    <StatTile label="Transmit" value={formatBytesPerSec(netTx)} />
                  </Grid>
                )}
              </Grid>
            </Box>
          )}

          {/* System stats */}
          {(loadAvg !== undefined || podCount !== undefined) && (
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
                System
              </Text>
              <Grid container spacing={0.5}>
                {loadAvg !== undefined && (
                  <Grid size={6}>
                    <StatTile label="Load (1m)" value={loadAvg.toFixed(2)} />
                  </Grid>
                )}
                {podCount !== undefined && (
                  <Grid size={6}>
                    <StatTile label="Pods" value={String(Math.round(podCount))} />
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </Stack>
      </Box>
    </Box>
  );
};

export default NodeMetricsSection;
