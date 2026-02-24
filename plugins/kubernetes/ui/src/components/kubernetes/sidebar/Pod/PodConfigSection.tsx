import React from "react";

// @omniviewdev/ui
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import { Chip } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

// project imports
import KVCard from "../../../shared/KVCard";

// types
import type { Pod, Toleration } from "kubernetes-types/core/v1";

interface Props {
  pod: Pod;
}

// ---------------------------------------------------------------------------
// Shared entry row — matches StatusEntry in PodStatusSection
// ---------------------------------------------------------------------------

const ConfigEntry: React.FC<{
  label: string;
  value?: string | React.ReactNode;
}> = ({ label, value }) => {
  if (value === undefined || value === null) return null;
  return (
    <Grid container spacing={0} sx={{ minHeight: 22, alignItems: "center" }}>
      <Grid size={4}>
        <Text sx={{ color: "neutral.300" }} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={8}>
        {typeof value === "string" ? (
          <Text sx={{ fontWeight: 600, fontSize: 12 }} size="xs">
            {value}
          </Text>
        ) : (
          value
        )}
      </Grid>
    </Grid>
  );
};

// ---------------------------------------------------------------------------
// Tolerations
// ---------------------------------------------------------------------------

const effectColor = (effect?: string): "danger" | "warning" | "neutral" => {
  switch (effect) {
    case "NoExecute":
      return "danger";
    case "NoSchedule":
      return "warning";
    case "PreferNoSchedule":
      return "neutral";
    default:
      return "neutral";
  }
};

const TolerationRow: React.FC<{ toleration: Toleration; isLast: boolean }> = ({ toleration, isLast }) => {
  const isMatchAll = !toleration.key;
  const key = toleration.key || "*";
  const isExists = toleration.operator === "Exists" || !toleration.operator;

  return (
    <Box
      sx={{
        py: 0.75,
        px: 1,
        display: "flex",
        alignItems: "center",
        gap: 1,
        borderBottom: isLast ? "none" : "1px solid",
        borderColor: "divider",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Text
          size="xs"
          noWrap
          weight={isMatchAll ? "normal" : "semibold"}
          sx={{
            fontSize: 11,
            fontFamily: isMatchAll ? undefined : "var(--ov-font-mono, monospace)",
            fontStyle: isMatchAll ? "italic" : "normal",
            color: isMatchAll ? "text.secondary" : "text.primary",
          }}
        >
          {key}
        </Text>
      </Box>
      <Chip
        size="xs"
        emphasis="soft"
        color="neutral"
        sx={{ borderRadius: 1, fontSize: 10, fontFamily: "var(--ov-font-mono, monospace)", flexShrink: 0 }}
        label={isExists ? "Exists" : `= ${toleration.value || ""}`}
      />
      {toleration.effect && (
        <Chip
          size="xs"
          emphasis="soft"
          color={effectColor(toleration.effect)}
          sx={{ borderRadius: 1, fontSize: 10, flexShrink: 0 }}
          label={toleration.effect}
        />
      )}
      {toleration.tolerationSeconds != null && (
        <Chip
          size="xs"
          emphasis="outline"
          color="neutral"
          sx={{ borderRadius: 1, fontSize: 10, flexShrink: 0 }}
          label={`${toleration.tolerationSeconds}s`}
        />
      )}
    </Box>
  );
};

// ---------------------------------------------------------------------------
// PodConfigSection
// ---------------------------------------------------------------------------

const PodConfigSection: React.FC<Props> = ({ pod }) => {
  const spec = pod.spec;
  if (!spec) return null;

  // Security Context
  const sc = spec.securityContext;
  const hasSecurityContext =
    sc &&
    (sc.runAsUser != null ||
      sc.runAsGroup != null ||
      sc.fsGroup != null ||
      sc.runAsNonRoot != null);

  const nodeSelector = spec.nodeSelector as Record<string, string> | undefined;
  const tolerations = spec.tolerations;
  const hasTolerations = tolerations && tolerations.length > 0;

  return (
    <Stack direction="column" gap={0.5}>
      {/* Configuration card — same Box style as Status */}
      <Box sx={{ borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
        <Box sx={{ py: 0.5, px: 1 }}>
          <Text weight="semibold" size="sm">Configuration</Text>
        </Box>
        <Divider />
        <Box sx={{ py: 0.5, px: 1, bgcolor: "background.level1" }}>
          <ConfigEntry label="Service Account" value={spec.serviceAccountName || "default"} />
          <ConfigEntry label="Restart Policy" value={spec.restartPolicy || "Always"} />
          <ConfigEntry label="DNS Policy" value={spec.dnsPolicy || "ClusterFirst"} />
          <ConfigEntry label="Scheduler" value={spec.schedulerName || "default-scheduler"} />
          <ConfigEntry
            label="Termination GP"
            value={
              spec.terminationGracePeriodSeconds != null
                ? `${spec.terminationGracePeriodSeconds}s`
                : "30s"
            }
          />
          {spec.priority != null && (
            <ConfigEntry label="Priority" value={String(spec.priority)} />
          )}
          {spec.priorityClassName && (
            <ConfigEntry label="Priority Class" value={spec.priorityClassName} />
          )}
        </Box>

        {/* Security Context — inline subsection if present */}
        {hasSecurityContext && sc && (
          <>
            <Divider />
            <Box sx={{ py: 0.5, px: 1, bgcolor: "background.level1" }}>
              <Box sx={{ mb: 0.25 }}>
                <Text size="xs" weight="semibold" sx={{ color: "neutral.400", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Security Context
                </Text>
              </Box>
              {sc.runAsUser != null && (
                <ConfigEntry label="Run As User" value={String(sc.runAsUser)} />
              )}
              {sc.runAsGroup != null && (
                <ConfigEntry label="Run As Group" value={String(sc.runAsGroup)} />
              )}
              {sc.fsGroup != null && (
                <ConfigEntry label="FS Group" value={String(sc.fsGroup)} />
              )}
              {sc.runAsNonRoot != null && (
                <ConfigEntry label="Run As Non-Root" value={sc.runAsNonRoot ? "true" : "false"} />
              )}
            </Box>
          </>
        )}
      </Box>

      {nodeSelector && Object.keys(nodeSelector).length > 0 && (
        <KVCard title="Node Selector" kvs={nodeSelector} defaultExpanded />
      )}

      {hasTolerations && (
        <Box sx={{ borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
          <Box sx={{ py: 0.5, px: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Stack direction="row" gap={0.75} alignItems="center">
              <Text weight="semibold" size="sm">Tolerations</Text>
              <Chip size="xs" emphasis="outline" color="primary" sx={{ borderRadius: 1 }} label={String(tolerations.length)} />
            </Stack>
            <Stack direction="row" gap={0.5} alignItems="center">
              <Chip size="xs" emphasis="soft" color="danger" sx={{ borderRadius: 1, fontSize: 9 }} label="NoExecute" />
              <Chip size="xs" emphasis="soft" color="warning" sx={{ borderRadius: 1, fontSize: 9 }} label="NoSchedule" />
            </Stack>
          </Box>
          <Divider />
          <Box sx={{ bgcolor: "background.level1" }}>
            {tolerations.map((t, i) => (
              <TolerationRow
                key={`${t.key}-${t.effect}-${i}`}
                toleration={t}
                isLast={i === tolerations.length - 1}
              />
            ))}
          </Box>
        </Box>
      )}
    </Stack>
  );
};

export default PodConfigSection;
