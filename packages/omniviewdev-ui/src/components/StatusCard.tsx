import React from "react";
import MuiCard from "@mui/material/Card";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import type { SxProps, Theme } from "@mui/material/styles";

import type { Status } from "../types";
import StatusDot from "../feedback/StatusDot";

export interface StatusCardMeta {
  label: string;
  value: string | React.ReactNode;
}

export interface StatusCardProps {
  /** Resource or service name */
  title: string;
  /** Icon in the header */
  icon?: React.ReactNode;
  /** Current status */
  status: Status;
  /** Human-readable status label (defaults to status value) */
  statusLabel?: string;
  /** Optional description or summary */
  description?: string;
  /** Key-value metadata rows displayed below */
  metadata?: StatusCardMeta[];
  /** Action elements in the header */
  headerAction?: React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function StatusCard({
  title,
  icon,
  status,
  statusLabel,
  description,
  metadata,
  headerAction,
  sx,
}: StatusCardProps) {
  return (
    <MuiCard variant="outlined" sx={{ p: 0, ...sx as Record<string, unknown> }}>
      {/* Header */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 1 }}
        alignItems="center"
        justifyContent="space-between"
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          {icon && (
            <Box sx={{ display: "flex", color: "var(--ov-fg-muted)", fontSize: 16 }}>
              {icon}
            </Box>
          )}
          <Typography variant="subtitle2">{title}</Typography>
        </Stack>
        {headerAction}
      </Stack>
      <Divider />

      {/* Status area */}
      <Box sx={{ px: 1.5, py: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <StatusDot status={status} pulse={status === "pending"} />
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, textTransform: "capitalize" }}
          >
            {statusLabel ?? status}
          </Typography>
        </Stack>
        {description && (
          <Typography
            variant="body2"
            sx={{ color: "var(--ov-fg-muted)", mt: 0.5 }}
          >
            {description}
          </Typography>
        )}
      </Box>

      {/* Metadata */}
      {metadata && metadata.length > 0 && (
        <>
          <Divider />
          <Box sx={{ px: 1.5, py: 1 }}>
            {metadata.map((meta, i) => (
              <Stack
                key={meta.label}
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{
                  py: 0.5,
                  borderBottom: i < metadata.length - 1 ? "1px solid var(--ov-border-default)" : undefined,
                }}
              >
                <Typography variant="caption" sx={{ color: "var(--ov-fg-muted)" }}>
                  {meta.label}
                </Typography>
                <Typography variant="caption" sx={{ color: "var(--ov-fg-default)", fontWeight: 500 }}>
                  {meta.value}
                </Typography>
              </Stack>
            ))}
          </Box>
        </>
      )}
    </MuiCard>
  );
}

StatusCard.displayName = "StatusCard";
