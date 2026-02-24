import React from "react";
import { Chip } from "@omniviewdev/ui";

interface Props {
  value: string | undefined;
}

const STATUS_COLOR_MAP: Record<string, "success" | "warning" | "error"> = {
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
  deleting: "error",
  failed: "error",
  error: "error",
  stopped: "error",
  terminated: "error",
  "shutting-down": "error",
};

function getStatusColor(
  value: string | undefined
): "success" | "warning" | "error" | "default" {
  if (!value) return "default";
  return STATUS_COLOR_MAP[value] ?? STATUS_COLOR_MAP[value.toLowerCase()] ?? "default";
}

/**
 * Displays a resource status as a colored Chip.
 */
const StatusSection: React.FC<Props> = ({ value }) => {
  if (!value) return null;

  return (
    <Chip
      size="sm"
      variant="filled"
      color={getStatusColor(value)}
      label={value}
      sx={{ borderRadius: 1 }}
    />
  );
};

export default StatusSection;
