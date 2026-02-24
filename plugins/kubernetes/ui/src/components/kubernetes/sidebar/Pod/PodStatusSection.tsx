import React from "react";

// @omniviewdev/ui
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import { Chip, ClipboardText } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

// project imports
import ConditionChip from "../../../shared/ConditionChip";

// types
import type { Pod } from "kubernetes-types/core/v1";
import { Condition } from "kubernetes-types/meta/v1";

// third-party
import { formatRelative } from "date-fns";

interface Props {
  pod: Pod;
}

const phaseColor = (phase?: string): "success" | "warning" | "primary" | "danger" | "neutral" => {
  switch (phase) {
    case "Running":
      return "success";
    case "Pending":
      return "warning";
    case "Succeeded":
      return "primary";
    case "Failed":
      return "danger";
    default:
      return "neutral";
  }
};

const StatusEntry: React.FC<{
  label: string;
  value?: string | React.ReactNode;
}> = ({ label, value }) => {
  if (value === undefined || value === null) return null;
  return (
    <Grid container spacing={0} sx={{ minHeight: 22, alignItems: "center" }}>
      <Grid size={3}>
        <Text sx={{ color: "neutral.300" }} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={9}>
        {typeof value === "string" ? (
          <ClipboardText value={value} variant="inherit" sx={{ fontWeight: 600, fontSize: 12 }} />
        ) : (
          value
        )}
      </Grid>
    </Grid>
  );
};

const PodStatusSection: React.FC<Props> = ({ pod }) => {
  const phase = pod.status?.phase;
  const qosClass = pod.status?.qosClass;
  const podIP = pod.status?.podIP;
  const hostIP = pod.status?.hostIP;
  const nodeName = pod.spec?.nodeName;
  const startTime = pod.status?.startTime;
  const conditions = pod.status?.conditions;

  const totalRestarts =
    (pod.status?.containerStatuses?.reduce(
      (sum, cs) => sum + (cs.restartCount || 0),
      0,
    ) ?? 0) +
    (pod.status?.initContainerStatuses?.reduce(
      (sum, cs) => sum + (cs.restartCount || 0),
      0,
    ) ?? 0);

  return (
    <Box
      sx={{
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      {/* Header: title + phase chip + conditions */}
      <Box
        sx={{
          py: 0.5,
          px: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Stack direction="row" gap={0.75} alignItems="center" flexShrink={0}>
          <Text weight="semibold" size="sm">Status</Text>
          <Chip
            size="xs"
            color={phaseColor(phase)}
            emphasis="soft"
            sx={{ borderRadius: 1 }}
            label={phase || "Unknown"}
          />
        </Stack>
        {conditions && conditions.length > 0 && (
          <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
            {conditions.map((condition) => (
              <ConditionChip key={condition.type} condition={condition as unknown as Condition} />
            ))}
          </Stack>
        )}
      </Box>
      <Divider />
      <Box
        sx={{
          py: 0.5,
          px: 1,
          bgcolor: "background.level1",
        }}
      >
        <StatusEntry label="QoS" value={qosClass} />
        <StatusEntry label="Pod IP" value={podIP} />
        <StatusEntry label="Host IP" value={hostIP} />
        <StatusEntry
          label="Node"
          value={
            nodeName ? (
              <Chip
                size="xs"
                color="primary"
                emphasis="soft"
                sx={{ borderRadius: 1 }}
                label={nodeName}
              />
            ) : undefined
          }
        />
        {totalRestarts > 0 && (
          <StatusEntry
            label="Restarts"
            value={
              <Chip
                size="xs"
                color={totalRestarts > 5 ? "danger" : "warning"}
                emphasis="soft"
                sx={{ borderRadius: 1 }}
                label={String(totalRestarts)}
              />
            }
          />
        )}
        {startTime && (
          <StatusEntry
            label="Started"
            value={formatRelative(new Date(startTime), new Date())}
          />
        )}
      </Box>
    </Box>
  );
};

export default PodStatusSection;
