import React, { createContext, useContext } from "react";
import Box from "@mui/material/Box";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import type { PodMetricsMap } from "../../../../../../hooks/usePodMetricsBatch";

// ── Context for passing batch metrics to table cells ──

export const PodMetricsContext = createContext<PodMetricsMap>(new Map());

// ── Formatters ──

function formatCpu(millicores: number): string {
  if (millicores >= 1000) return `${(millicores / 1000).toFixed(1)}`;
  if (millicores >= 10) return `${Math.round(millicores)}m`;
  return `${millicores.toFixed(1)}m`;
}

function formatMemory(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(0)}Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}Ki`;
  return `${bytes}B`;
}

// ── Cell Component ──

interface MetricUsageCellProps {
  podKey: string; // "namespace/podName"
  format: "cpu" | "memory";
}

/**
 * Compact metric cell with a mini usage bar and text label.
 * Reads pod metrics from PodMetricsContext.
 */
const MetricUsageCell: React.FC<MetricUsageCellProps> = ({
  podKey,
  format,
}) => {
  const metricsMap = useContext(PodMetricsContext);
  const entry = metricsMap.get(podKey);

  if (!entry) {
    return (
      <Text
        sx={{
          fontSize: 12,
          color: "text.tertiary",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        —
      </Text>
    );
  }

  const raw = format === "cpu" ? entry.cpuMillicores : entry.memoryBytes;
  const label = format === "cpu" ? formatCpu(raw) : formatMemory(raw);

  // Estimate a percentage for the bar. Without per-pod limits available in the
  // table row we use a soft heuristic: CPU caps at 1000m (1 core),
  // memory caps at 512Mi. The bar is purely visual — the text is the truth.
  const pct =
    format === "cpu"
      ? Math.min((raw / 1000) * 100, 100)
      : Math.min((raw / (512 * 1024 * 1024)) * 100, 100);

  const barColor =
    pct > 80
      ? "error.main"
      : pct > 60
        ? "warning.main"
        : "success.main";

  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ width: "100%" }}>
      {/* Mini bar */}
      <Box
        sx={{
          flex: 1,
          minWidth: 24,
          maxWidth: 40,
          height: 6,
          borderRadius: 3,
          bgcolor: "action.hover",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            width: `${Math.max(pct, 2)}%`,
            height: "100%",
            borderRadius: 3,
            bgcolor: barColor,
            transition: "width 0.4s ease",
          }}
        />
      </Box>
      {/* Value text */}
      <Text
        noWrap
        sx={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          fontFamily: "var(--ov-font-mono, monospace)",
          lineHeight: 1,
        }}
      >
        {label}
      </Text>
    </Stack>
  );
};

export default MetricUsageCell;
