import React from "react";
import MuiCard from "@mui/material/Card";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { SxProps, Theme } from "@mui/material/styles";

import type { SemanticColor } from "../types";
import { toCssColor } from "../types";

export interface StatCardProps {
  /** The large metric value (e.g. "42", "99.9%", "3.2s") */
  value: string | number;
  /** Label beneath the value */
  label: string;
  /** Optional description text */
  description?: string;
  /** Icon displayed in the top-right corner */
  icon?: React.ReactNode;
  /** Trend indicator: positive = up/green, negative = down/red, zero = neutral */
  trend?: { value: number; label?: string };
  /** Accent color for the value and trend */
  color?: SemanticColor;
  sx?: SxProps<Theme>;
}

export default function StatCard({
  value,
  label,
  description,
  icon,
  trend,
  color = "primary",
  sx,
}: StatCardProps) {
  const trendDirection = trend ? (trend.value > 0 ? "up" : trend.value < 0 ? "down" : "flat") : undefined;
  const trendColor = trendDirection === "up" ? "var(--ov-success-default)" : trendDirection === "down" ? "var(--ov-danger-default)" : "var(--ov-fg-muted)";
  const trendArrow = trendDirection === "up" ? "\u2191" : trendDirection === "down" ? "\u2193" : "\u2192";

  return (
    <MuiCard
      variant="outlined"
      sx={{
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        ...sx as Record<string, unknown>,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography
            sx={{
              fontSize: "var(--ov-text-2xl)",
              fontWeight: 700,
              lineHeight: 1.2,
              color: `var(${toCssColor(color)})`,
            }}
          >
            {value}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "var(--ov-fg-muted)", fontWeight: 500, mt: 0.25 }}
          >
            {label}
          </Typography>
        </Box>
        {icon && (
          <Box sx={{ color: "var(--ov-fg-faint)", fontSize: 24, display: "flex" }}>
            {icon}
          </Box>
        )}
      </Stack>
      {(trend || description) && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
          {trend && (
            <Typography
              variant="caption"
              sx={{ color: trendColor, fontWeight: 600 }}
            >
              {trendArrow} {Math.abs(trend.value)}%{trend.label ? ` ${trend.label}` : ""}
            </Typography>
          )}
          {description && (
            <Typography variant="caption" sx={{ color: "var(--ov-fg-faint)" }}>
              {description}
            </Typography>
          )}
        </Stack>
      )}
    </MuiCard>
  );
}

StatCard.displayName = "StatCard";
