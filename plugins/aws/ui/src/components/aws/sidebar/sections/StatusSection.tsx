import React from "react";
import { Chip } from "@mui/joy";

interface Props {
  value: string | undefined;
}

const STATUS_COLOR_MAP: Record<string, "success" | "warning" | "danger"> = {
  running: "success",
  available: "success",
  active: "success",
  ACTIVE: "success",
  "in-use": "success",
  attached: "success",
  enabled: "success",
  healthy: "success",
  creating: "warning",
  pending: "warning",
  modifying: "warning",
  "in-progress": "warning",
  updating: "warning",
  deleting: "danger",
  failed: "danger",
  error: "danger",
  stopped: "danger",
  terminated: "danger",
  "shutting-down": "danger",
};

function getStatusColor(
  value: string | undefined
): "success" | "warning" | "danger" | "neutral" {
  if (!value) return "neutral";
  return STATUS_COLOR_MAP[value] ?? STATUS_COLOR_MAP[value.toLowerCase()] ?? "neutral";
}

/**
 * Displays a resource status as a colored Chip.
 */
const StatusSection: React.FC<Props> = ({ value }) => {
  if (!value) return null;

  return (
    <Chip
      size="sm"
      variant="soft"
      color={getStatusColor(value)}
      sx={{ borderRadius: "sm" }}
    >
      {value}
    </Chip>
  );
};

export default StatusSection;
