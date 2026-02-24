import React, { useState, useMemo, useCallback } from "react";

import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import { DrawerComponentView, DrawerContext, useResourceMetrics } from "@omniviewdev/runtime";
import type { metric } from "@omniviewdev/runtime/models";
import { MetricsPanel } from "@omniviewdev/ui/charts";
import type { TimeSeriesDef, ChartTimeRange, MetricFormat } from "@omniviewdev/ui/charts";
import { TimeRangePicker } from "@omniviewdev/ui/inputs";
import type { TimeRange } from "@omniviewdev/ui/inputs";
import { LuActivity } from "react-icons/lu";
import { useClusterPreferences } from "../../../../../hooks/useClusterPreferences";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "var(--ov-accent, #3b82f6)",
  "var(--ov-accent-secondary, #8b5cf6)",
  "#22c55e",
  "#f97316",
  "#ec4899",
  "#06b6d4",
];

// ---------------------------------------------------------------------------
// Unit formatting
// ---------------------------------------------------------------------------

const UNIT_LABELS: Record<number, string> = {
  0: "",        // NONE
  1: "B",       // BYTES
  2: "KB",
  3: "MB",
  4: "GB",
  5: "%",       // PERCENTAGE
  6: "ms",      // MILLISECONDS
  7: "s",       // SECONDS
  8: "",        // COUNT
  9: "ops/s",   // OPS_PER_SEC
  10: "B/s",    // BYTES_PER_SEC
  11: "m",      // MILLICORES
  12: "cores",  // CORES
};

/** Format CPU cores with automatic millicores for small values */
function formatCores(v: number | null): string {
  if (v == null) return "–";
  if (v === 0) return "0 cores";
  if (Math.abs(v) < 0.01) return `${(v * 1000).toFixed(1)}m`;
  if (Math.abs(v) < 0.1) return `${(v * 1000).toFixed(0)}m`;
  if (Math.abs(v) < 1) return `${v.toFixed(3)} cores`;
  return `${v.toFixed(2)} cores`;
}

/** Format ops/sec */
function formatOps(v: number | null): string {
  if (v == null) return "–";
  if (v === 0) return "0 ops/s";
  if (v < 0.01) return `${(v * 1000).toFixed(2)} mops/s`;
  if (v < 1) return `${v.toFixed(3)} ops/s`;
  if (v < 1000) return `${v.toFixed(1)} ops/s`;
  return `${(v / 1000).toFixed(1)} Kops/s`;
}

function formatValue(value: number, unitCode: number): string {
  const unit = UNIT_LABELS[unitCode] ?? "";

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
  if (unitCode === 9) return formatOps(value);
  if (unitCode === 11 || unitCode === 12) return formatCores(value) ?? "";
  if (unitCode === 5) return `${value.toFixed(1)}%`;
  // Seconds -> human readable uptime
  if (unitCode === 7) {
    if (value >= 86400) return `${(value / 86400).toFixed(1)}d`;
    if (value >= 3600) return `${(value / 3600).toFixed(1)}h`;
    if (value >= 60) return `${(value / 60).toFixed(0)}m`;
    return `${value.toFixed(0)}s`;
  }
  if (Number.isInteger(value)) return `${value}${unit ? ` ${unit}` : ""}`;
  return `${value.toFixed(2)}${unit ? ` ${unit}` : ""}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DescriptorMap = Map<string, metric.MetricDescriptor>;

function collectDescriptors(
  providers: metric.MetricProviderSummary[],
): DescriptorMap {
  const map: DescriptorMap = new Map();
  for (const provider of providers) {
    for (const handler of provider.handlers ?? []) {
      for (const desc of handler.metrics ?? []) {
        if (desc.id) map.set(desc.id, desc);
      }
    }
  }
  return map;
}

/** Returns the set of metric IDs that support time-series (shape=1). */
function getTimeSeriesMetricIDs(descriptors: DescriptorMap): Set<string> {
  const ids = new Set<string>();
  for (const [id, desc] of descriptors) {
    if (desc.supported_shapes?.includes(1)) {
      ids.add(id);
    }
  }
  return ids;
}

function extractCurrentValues(
  data: Record<string, metric.QueryResponse> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!data) return out;
  for (const resp of Object.values(data)) {
    if (!resp?.success || !resp.results) continue;
    for (const result of resp.results) {
      if (result.current_value) {
        out.set(result.current_value.metric_id, result.current_value.value);
      }
    }
  }
  return out;
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

function toTimeSeriesDef(
  ts: metric.TimeSeries,
  label: string,
  color: string,
  opts?: { area?: boolean; lineStyle?: "solid" | "dashed" | "dotted" },
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
// Data-driven chart building from descriptors
// ---------------------------------------------------------------------------

interface ChartDef {
  title: string;
  metricIDs: string[];
  labels: Record<string, string>;
  colors: Record<string, string>;
  valueFormat: MetricFormat;
  valueFormatter?: (v: number | null) => string;
  unit?: string;
}

/** Map MetricUnit enum to MetricFormat for chart rendering. */
function unitToFormat(unit: number): MetricFormat {
  if (unit === 5) return "percent";     // UnitPercentage
  if (unit === 1 || unit === 10) return "bytes"; // UnitBytes, UnitBytesPerSec
  return "number";
}

/** Map MetricUnit enum to unit suffix for chart display. */
function unitToSuffix(unit: number): string | undefined {
  if (unit === 10) return "/s"; // UnitBytesPerSec
  return undefined;
}

/** Pick a valueFormatter based on the primary unit in the group. */
function unitToFormatter(unit: number): ((v: number | null) => string) | undefined {
  if (unit === 11 || unit === 12) return formatCores; // millicores, cores
  if (unit === 9) return formatOps;                    // ops/sec
  return undefined;
}

/**
 * Build chart definitions dynamically from descriptor metadata.
 * Metrics sharing the same `chart_group` value are rendered on the same chart.
 * The group value is used as the chart title.
 */
function buildChartsFromDescriptors(
  descriptors: DescriptorMap,
  tsSeries: Map<string, metric.TimeSeries>,
): ChartDef[] {
  const groupMap = new Map<string, { descs: metric.MetricDescriptor[]; hasData: boolean }>();

  for (const [id, desc] of descriptors) {
    if (!desc.chart_group || !desc.supported_shapes?.includes(1)) continue;
    let group = groupMap.get(desc.chart_group);
    if (!group) {
      group = { descs: [], hasData: false };
      groupMap.set(desc.chart_group, group);
    }
    group.descs.push(desc);
    if (tsSeries.has(id)) group.hasData = true;
  }

  return [...groupMap.entries()]
    .filter(([, g]) => g.hasData)
    .map(([title, g]) => ({
      title,
      metricIDs: g.descs.map((d) => d.id),
      labels: Object.fromEntries(g.descs.map((d) => [d.id, d.name])),
      colors: Object.fromEntries(
        g.descs.map((d, i) => [d.id, CHART_COLORS[i % CHART_COLORS.length]]),
      ),
      valueFormat: unitToFormat(g.descs[0].unit),
      valueFormatter: unitToFormatter(g.descs[0].unit),
      unit: unitToSuffix(g.descs[0].unit),
    }));
}

// Icon -> category mapping for tile grouping
const ICON_CATEGORIES: Record<string, string> = {
  LuCpu: "CPU",
  LuMemoryStick: "Memory",
  LuHardDrive: "Storage",
  LuHardDriveDownload: "Storage",
  LuHardDriveUpload: "Storage",
  LuArrowDown: "Network",
  LuArrowUp: "Network",
  LuNetwork: "Network",
  LuActivity: "System",
  LuArrowLeftRight: "System",
  LuBox: "Pods",
  LuServer: "Nodes",
  LuRotateCcw: "Lifecycle",
  LuPlay: "Status",
  LuClock: "Lifecycle",
  LuAlertTriangle: "Lifecycle",
};

const CATEGORY_ORDER = [
  "CPU", "Memory", "Storage", "Network", "System",
  "Pods", "Nodes", "Lifecycle", "Status", "Other",
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const PercentGauge: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const color = value >= 90 ? "error" : value >= 70 ? "warning" : "primary";
  return (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.25 }}>
        <Text size="xs" sx={{ color: "neutral.400" }}>{label}</Text>
        <Text size="xs" weight="semibold" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {value.toFixed(1)}%
        </Text>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(value, 100)}
        color={color}
        sx={{ height: 4, borderRadius: 2 }}
      />
    </Box>
  );
};

const MetricTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Box
    sx={{
      py: 0.75, px: 1,
      borderRadius: 1,
      border: "1px solid",
      borderColor: "divider",
      bgcolor: "background.level1",
    }}
  >
    <Text size="xs" sx={{ color: "neutral.400", mb: 0.25, display: "block" }}>{label}</Text>
    <Text size="sm" weight="semibold" sx={{ fontVariantNumeric: "tabular-nums" }}>{value}</Text>
  </Box>
);

// ---------------------------------------------------------------------------
// Tile grouping
// ---------------------------------------------------------------------------

type TileGroup = {
  category: string;
  metrics: { id: string; name: string; value: number; unit: number }[];
};

function buildTileGroups(
  values: Map<string, number>,
  chartMetricIDs: Set<string>,
  descriptors: DescriptorMap,
): TileGroup[] {
  const groups = new Map<string, TileGroup["metrics"]>();

  for (const [metricId, value] of values) {
    // Skip metrics that are rendered as charts
    if (chartMetricIDs.has(metricId)) continue;

    const desc = descriptors.get(metricId);
    const category = desc?.icon ? (ICON_CATEGORIES[desc.icon] ?? "Other") : "Other";

    let list = groups.get(category);
    if (!list) {
      list = [];
      groups.set(category, list);
    }
    list.push({
      id: metricId,
      name: desc?.name || metricId,
      value,
      unit: desc?.unit ?? 0,
    });
  }

  return CATEGORY_ORDER
    .filter((cat) => groups.has(cat))
    .map((cat) => ({ category: cat, metrics: groups.get(cat)! }));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  ctx: DrawerContext<any>;
}

const ResourceMetricsPage: React.FC<Props> = ({ ctx }) => {
  const resourceKey = ctx.resource?.key || "";
  const connectionID = ctx.resource?.connectionID || "";
  const resourceID = ctx.resource?.id || "";
  const resourceNamespace =
    (ctx.data as Record<string, any>)?.metadata?.namespace ?? "";

  const { connectionOverrides } = useClusterPreferences("kubernetes");
  const metricConfig = connectionOverrides[connectionID]?.metricConfig;

  const enrichedData = useMemo(() => {
    const base = (ctx.data ?? {}) as Record<string, unknown>;
    if (
      !metricConfig?.prometheusService &&
      !metricConfig?.prometheusNamespace &&
      !metricConfig?.prometheusPort
    ) {
      return base;
    }
    return {
      ...base,
      __metric_config__: {
        service: metricConfig.prometheusService || "",
        namespace: metricConfig.prometheusNamespace || "",
        port: metricConfig.prometheusPort || 0,
      },
    };
  }, [ctx.data, metricConfig]);

  // Time range state for charts (shared across all panels)
  const [timeRange, setTimeRange] = useState<ChartTimeRange>({
    from: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    to: new Date(),
  });

  // Instant values (shape=0) for tiles and current value display
  const { data: currentData, providers, isLoading: currentLoading, error } = useResourceMetrics({
    pluginID: "kubernetes",
    connectionID,
    resourceKey,
    resourceID,
    resourceNamespace,
    resourceData: enrichedData,
    refreshInterval: 30000,
  });

  const descriptors = useMemo(() => collectDescriptors(providers), [providers]);
  const tsMetricIDs = useMemo(() => getTimeSeriesMetricIDs(descriptors), [descriptors]);
  const tsMetricIDList = useMemo(() => [...tsMetricIDs], [tsMetricIDs]);

  // Time-series query (shape=1) - only if descriptors declare time-series support
  const { data: tsData, isLoading: tsLoading } = useResourceMetrics({
    pluginID: "kubernetes",
    connectionID,
    resourceKey,
    resourceID,
    resourceNamespace,
    resourceData: enrichedData,
    shape: 1,
    timeRange: {
      start: timeRange.from,
      end: timeRange.to,
      step: "",
    },
    metricIDs: tsMetricIDList,
    refreshInterval: 30000,
    enabled: tsMetricIDList.length > 0,
  });

  const currentValues = useMemo(() => extractCurrentValues(currentData), [currentData]);
  const tsSeries = useMemo(() => extractTimeSeries(tsData), [tsData]);

  // Build charts dynamically from descriptor chart_group metadata
  const charts = useMemo(
    () => buildChartsFromDescriptors(descriptors, tsSeries),
    [descriptors, tsSeries],
  );

  // Collect all metric IDs that belong to a chart_group (exclude from tiles)
  const chartMetricIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, desc] of descriptors) {
      if (desc.chart_group) ids.add(id);
    }
    return ids;
  }, [descriptors]);

  const tileGroups = useMemo(
    () => buildTileGroups(currentValues, chartMetricIDs, descriptors),
    [currentValues, chartMetricIDs, descriptors],
  );

  // Bridge TimeRange ↔ ChartTimeRange (same shape, different type names)
  const handlePickerChange = useCallback((range: TimeRange) => {
    setTimeRange({ from: range.from, to: range.to });
  }, []);

  const isLoading = currentLoading && currentValues.size === 0;
  const hasAnyData = currentValues.size > 0 || tsSeries.size > 0;
  const noProviders = !currentLoading && providers.length === 0;
  const noData = !hasAnyData && !error && !isLoading;

  // Zero early returns — every render must call the same hooks.
  return (
    <Box sx={{ p: 1 }}>
      {/* No providers */}
      {noProviders && (
        <Box sx={{ p: 2 }}>
          <Text size="sm" sx={{ color: "neutral.500" }}>
            No metric providers registered for this resource type.
          </Text>
        </Box>
      )}

      {/* Loading initial data */}
      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* No data message */}
      {noData && (
        <Box sx={{ p: 2 }}>
          <Text size="sm" sx={{ color: "neutral.500" }}>
            No metrics available. Ensure metrics-server or Prometheus is installed
            in the cluster.
          </Text>
        </Box>
      )}

      {/* Error banner */}
      {error && (
        <Box sx={{ mb: 1 }}>
          <Text size="xs" sx={{ color: "error.main" }}>
            {error.message || "Failed to load metrics"}
          </Text>
        </Box>
      )}

      {/* Refresh indicator */}
      {(currentLoading || tsLoading) && hasAnyData && (
        <LinearProgress sx={{ height: 2, borderRadius: 1, mb: 0.5 }} />
      )}

      {/* Main content — only when we have data */}
      {hasAnyData && <>
      <TimeRangePicker
        value={timeRange}
        onChange={handlePickerChange}
        sx={{ mb: 1 }}
      />

      {/* Charts grid — 2-up when wide enough */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: 1,
          mb: 1.5,
        }}
      >
        {charts.map((def) => {
          const series: TimeSeriesDef[] = [];

          for (const id of def.metricIDs) {
            const ts = tsSeries.get(id);
            if (!ts) continue;
            series.push(
              toTimeSeriesDef(
                ts,
                def.labels[id] || id,
                def.colors[id] || CHART_COLORS[series.length % CHART_COLORS.length],
              ),
            );
          }

          return (
            <MetricsPanel
              key={def.title}
              title={def.title}
              series={series}
              timeRange={timeRange}
              valueFormat={def.valueFormat}
              valueFormatter={def.valueFormatter}
              unit={def.unit}
              area
              variant="default"
              height={200}
            />
          );
        })}
      </Box>

      {/* Tile-only metrics (instant values without time-series) */}
      {tileGroups.length > 0 && (
        <Stack spacing={0.75}>
          {tileGroups.map((group) => (
            <Box key={group.category} sx={{ px: 0.5 }}>
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
                {group.category}
              </Text>

              {group.metrics.some((m) => m.unit === 5) && (
                <Stack spacing={0.75} sx={{ mb: 0.5 }}>
                  {group.metrics
                    .filter((m) => m.unit === 5)
                    .map((m) => (
                      <PercentGauge key={m.id} label={m.name} value={m.value} />
                    ))}
                </Stack>
              )}

              {group.metrics.some((m) => m.unit !== 5) && (
                <Grid container spacing={0.5}>
                  {group.metrics
                    .filter((m) => m.unit !== 5)
                    .map((m) => {
                      const count = group.metrics.filter((x) => x.unit !== 5).length;
                      return (
                        <Grid key={m.id} size={count === 1 ? 12 : 6}>
                          <MetricTile
                            label={m.name}
                            value={formatValue(m.value, m.unit)}
                          />
                        </Grid>
                      );
                    })}
                </Grid>
              )}
            </Box>
          ))}
        </Stack>
      )}
      </>}
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMetricsView(): DrawerComponentView<any> {
  return {
    title: "Metrics",
    icon: <LuActivity />,
    component: (ctx) => <ResourceMetricsPage ctx={ctx} />,
  };
}

export default ResourceMetricsPage;
