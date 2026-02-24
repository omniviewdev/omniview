import React from "react";

import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import { Chip } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

import type { Scheduling } from "kubernetes-types/node/v1";
import type { Toleration } from "kubernetes-types/core/v1";
import KVCard from "../../../../../shared/KVCard";

interface Props {
  scheduling: Scheduling;
}

const effectColors: Record<string, "primary" | "warning" | "danger" | "neutral"> = {
  NoSchedule: "warning",
  PreferNoSchedule: "primary",
  NoExecute: "danger",
};

const TolerationRow: React.FC<{ t: Toleration; index: number }> = ({
  t,
  index,
}) => (
  <Box
    sx={{
      py: 0.5,
      px: 1,
      bgcolor: index % 2 === 0 ? "background.level1" : "transparent",
    }}
  >
    <Grid container spacing={0} sx={{ minHeight: 24, alignItems: "center" }}>
      <Grid size={4}>
        <Text size="xs" sx={{ fontWeight: 600, fontSize: 12 }} noWrap>
          {t.key || "*"}
        </Text>
      </Grid>
      <Grid size={4}>
        <Stack direction="row" gap={0.5} alignItems="center">
          <Chip size="sm" variant="outlined">
            {t.operator === "Exists" ? "Exists" : `= ${t.value ?? ""}`}
          </Chip>
        </Stack>
      </Grid>
      <Grid size={4}>
        <Stack direction="row" gap={0.5} alignItems="center">
          {t.effect && (
            <Chip size="sm" color={effectColors[t.effect] ?? "neutral"}>
              {t.effect}
            </Chip>
          )}
          {t.tolerationSeconds != null && (
            <Text size="xs" sx={{ color: "neutral.300" }}>
              {t.tolerationSeconds}s
            </Text>
          )}
        </Stack>
      </Grid>
    </Grid>
  </Box>
);

const RuntimeClassSchedulingSection: React.FC<Props> = ({ scheduling }) => {
  const nodeSelector = scheduling.nodeSelector;
  const tolerations = scheduling.tolerations;

  const hasNodeSelector =
    nodeSelector && Object.keys(nodeSelector).length > 0;
  const hasTolerations = tolerations && tolerations.length > 0;

  if (!hasNodeSelector && !hasTolerations) return null;

  return (
    <Stack direction="column" spacing={1.5}>
      {hasNodeSelector && (
        <KVCard
          title="Node Selector"
          kvs={nodeSelector}
          defaultExpanded
          size="sm"
        />
      )}

      {hasTolerations && (
        <Box
          sx={{
            borderRadius: 1,
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box sx={{ py: 0.5, px: 1 }}>
            <Stack direction="row" gap={0.75} alignItems="center">
              <Text weight="semibold" size="sm">
                Tolerations
              </Text>
              <Chip size="sm" variant="outlined">
                {tolerations.length}
              </Chip>
            </Stack>
          </Box>
          <Divider />
          {tolerations.map((t, i) => (
            <TolerationRow key={`${t.key}-${t.effect}-${i}`} t={t} index={i} />
          ))}
        </Box>
      )}
    </Stack>
  );
};

export default RuntimeClassSchedulingSection;
