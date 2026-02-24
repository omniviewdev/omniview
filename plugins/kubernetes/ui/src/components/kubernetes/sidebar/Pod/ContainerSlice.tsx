import React from "react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import { Chip, ClipboardText } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import {
  Container,
  ContainerStateTerminated,
  ContainerStatus,
  Pod,
  Probe,
  Volume,
} from "kubernetes-types/core/v1";
import { ContainerStatusDecorator } from "./ContainerStatuses";
import { getStatus } from "./utils";
import Icon from "../../../shared/Icon";
import DetailsCard, { DetailsCardEntry } from "../../../shared/DetailsCard";
import PortDetailsCard from "./PortDetailsCard";
import { formatRelative } from "date-fns";

type ContainerType = "container" | "init" | "ephemeral";

export interface ContainerSliceProps {
  resourceID: string;
  connectionID: string;
  container: Container;
  status?: ContainerStatus;
  type: ContainerType;
  pod?: Pod;
  volumes?: Volume[];
  /** Pod-level CPU usage in millicores (from metrics-server) */
  podCpuUsage?: number;
  /** Pod-level memory usage in bytes (from metrics-server) */
  podMemoryUsage?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const statusDotColor = (status?: ContainerStatus): string => {
  if (!status) return "grey.500";
  const info = getStatus(status);
  switch (info.color) {
    case "success":
      return "success.main";
    case "warning":
      return "warning.main";
    case "danger":
      return "error.main";
    case "primary":
      return "primary.main";
    default:
      return "grey.500";
  }
};

const typeLabel = (type: ContainerType): string | undefined => {
  switch (type) {
    case "init":
      return "Init";
    case "ephemeral":
      return "Ephemeral";
    default:
      return undefined;
  }
};

const typeChipColor = (
  type: ContainerType,
): "warning" | "primary" | undefined => {
  switch (type) {
    case "init":
      return "warning";
    case "ephemeral":
      return "primary";
    default:
      return undefined;
  }
};

// ── Resolve a fieldRef path against a Pod object ──
function resolveFieldRef(
  pod: Pod,
  fieldPath: string,
): string | undefined {
  try {
    const parts = fieldPath.split(".");
    let current: any = pod;
    for (const part of parts) {
      const bracketMatch = part.match(/^(\w+)\['(.+)'\]$/);
      if (bracketMatch) {
        current = current?.[bracketMatch[1]]?.[bracketMatch[2]];
      } else {
        current = current?.[part];
      }
      if (current == null) return undefined;
    }
    return typeof current === "object"
      ? JSON.stringify(current)
      : String(current);
  } catch {
    return undefined;
  }
}

// ── Resolve a resourceFieldRef against a Container's resources ──
function resolveResourceFieldRef(
  container: Container,
  resource: string,
): string | undefined {
  const parts = resource.split(".");
  if (parts.length !== 2) return undefined;
  const [type, name] = parts;
  if (type === "limits") {
    return container.resources?.limits?.[name] as string | undefined;
  }
  if (type === "requests") {
    return container.resources?.requests?.[name] as string | undefined;
  }
  return undefined;
}

// ── Get volume type from the pod's volumes list by mount name ──
function getVolumeType(
  volumes: Volume[] | undefined,
  name: string,
): string | undefined {
  const vol = volumes?.find((v) => v.name === name);
  if (!vol) return undefined;
  if (vol.configMap) return "ConfigMap";
  if (vol.secret) return "Secret";
  if (vol.persistentVolumeClaim) return "PVC";
  if (vol.emptyDir) return "EmptyDir";
  if (vol.hostPath) return "HostPath";
  if (vol.projected) return "Projected";
  if (vol.downwardAPI) return "DownwardAPI";
  if (vol.csi) return "CSI";
  if (vol.nfs) return "NFS";
  return "Unknown";
}

function volumeTypeColor(
  type: string,
): "primary" | "warning" | "success" | "neutral" {
  switch (type) {
    case "ConfigMap":
      return "primary";
    case "Secret":
      return "warning";
    case "PVC":
      return "success";
    case "HostPath":
      return "warning";
    default:
      return "neutral";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// K8s resource string parsers
// ────────────────────────────────────────────────────────────────────────────

/** Parse a K8s CPU resource string to millicores. "100m"→100, "0.5"→500, "1"→1000 */
function parseCpuToMillicores(s: string): number {
  if (s.endsWith("m")) {
    return parseFloat(s.slice(0, -1));
  }
  return parseFloat(s) * 1000;
}

/** Parse a K8s memory resource string to bytes. "128Mi"→134217728, "1Gi"→1073741824 */
function parseMemoryToBytes(s: string): number {
  const match = s.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/);
  if (!match) return parseFloat(s) || 0;
  const val = parseFloat(match[1]);
  switch (match[2]) {
    case "Ki": return val * 1024;
    case "Mi": return val * 1024 * 1024;
    case "Gi": return val * 1024 * 1024 * 1024;
    case "Ti": return val * 1024 * 1024 * 1024 * 1024;
    case "k": case "K": return val * 1000;
    case "M": return val * 1000 * 1000;
    case "G": return val * 1000 * 1000 * 1000;
    case "T": return val * 1000 * 1000 * 1000 * 1000;
    case "": return val;
    default: return val;
  }
}

/** Format millicores for display: "5m", "1.2" (cores) */
function formatCpu(millicores: number): string {
  if (millicores >= 1000) return `${(millicores / 1000).toFixed(1)}`;
  return `${Math.round(millicores)}m`;
}

/** Format bytes for display: "92Mi", "1.3Gi" */
function formatMemory(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}Ki`;
  return `${bytes}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Probes
// ────────────────────────────────────────────────────────────────────────────

const getProbeTarget = (probe: Probe): string => {
  if (probe.httpGet) {
    return `http-get ${probe.httpGet.host || ""}:${probe.httpGet.port}${probe.httpGet.path || ""}`;
  }
  if (probe.tcpSocket) {
    return `tcp-socket :${probe.tcpSocket.port}`;
  }
  if (probe.exec?.command) {
    return probe.exec.command.join(" ");
  }
  if (probe.grpc) {
    return `grpc :${probe.grpc.port}`;
  }
  return "";
};

const probeEntry = (probe: Probe): DetailsCardEntry[] => [
  { key: "Probe", value: getProbeTarget(probe), ratio: [5, 7] },
  {
    key: "Initial Delay",
    value: `${probe.initialDelaySeconds ?? 0}s`,
    ratio: [5, 7],
  },
  {
    key: "Timeout",
    value: `${probe.timeoutSeconds ?? 1}s`,
    ratio: [5, 7],
  },
  {
    key: "Period",
    value: `${probe.periodSeconds ?? 10}s`,
    ratio: [5, 7],
  },
  {
    key: "Success Threshold",
    value: String(probe.successThreshold ?? 1),
    ratio: [5, 7],
  },
  {
    key: "Failure Threshold",
    value: String(probe.failureThreshold ?? 3),
    ratio: [5, 7],
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

// ── Info row with wrapping text for long values (image, command, args) ──
const InfoRow: React.FC<{ icon: string; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => (
  <Grid
    container
    spacing={0.5}
    sx={{ minHeight: 28, alignItems: "flex-start" }}
  >
    <Grid
      size={3}
      sx={{ display: "flex", alignItems: "center", minHeight: 28 }}
    >
      <Stack direction="row" gap={0.75} alignItems="center">
        <Icon name={icon} size={14} />
        <Text sx={{ fontSize: 13 }}>{label}</Text>
      </Stack>
    </Grid>
    <Grid
      size={9}
      sx={{ display: "flex", alignItems: "center", minHeight: 28 }}
    >
      <ClipboardText
        value={value}
        truncate={false}
        sx={{
          color: "neutral.200",
          wordBreak: "break-all",
          lineHeight: 1.6,
          fontSize: 13,
          py: 0.25,
        }}
      />
    </Grid>
  </Grid>
);

// ── Resource utilization bar row ──
const ResourceBar: React.FC<{
  label: string;
  icon: string;
  request: string;
  limit: string;
  usage?: number; // 0-100 percentage — future metrics integration
}> = ({ label, icon, request, limit, usage }) => {
  const barColor =
    usage != null
      ? usage > 80
        ? "error.main"
        : usage > 60
          ? "warning.main"
          : "success.main"
      : "primary.main";

  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ minHeight: 32 }}
    >
      <Stack
        direction="row"
        gap={0.75}
        alignItems="center"
        sx={{ minWidth: 85, flexShrink: 0 }}
      >
        <Icon name={icon} size={14} />
        <Text sx={{ fontSize: 13 }}>{label}</Text>
      </Stack>
      <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
        <Box
          sx={{
            width: "100%",
            height: 10,
            borderRadius: 5,
            bgcolor: "action.hover",
            overflow: "hidden",
          }}
        >
          {usage != null && (
            <Box
              sx={{
                width: `${Math.min(usage, 100)}%`,
                height: "100%",
                borderRadius: 5,
                bgcolor: barColor,
                transition: "width 0.3s ease",
              }}
            />
          )}
        </Box>
      </Box>
      <Text
        sx={{
          fontSize: 12,
          color: "neutral.300",
          minWidth: 100,
          textAlign: "right",
          flexShrink: 0,
        }}
        noWrap
      >
        {request} / {limit}
      </Text>
    </Stack>
  );
};

// ── Restart / termination info card ──
const formatTerminated = (t: ContainerStateTerminated) => {
  const parts: { label: string; value: string; color?: string }[] = [];
  if (t.reason) parts.push({ label: "Reason", value: t.reason, color: t.reason === "Completed" ? "success.main" : "error.main" });
  if (t.exitCode != null) parts.push({ label: "Exit Code", value: String(t.exitCode), color: t.exitCode === 0 ? "success.main" : "error.main" });
  if (t.signal) parts.push({ label: "Signal", value: String(t.signal) });
  if (t.message) parts.push({ label: "Message", value: t.message });
  if (t.startedAt) parts.push({ label: "Started", value: formatRelative(new Date(t.startedAt), new Date()) });
  if (t.finishedAt) parts.push({ label: "Finished", value: formatRelative(new Date(t.finishedAt), new Date()) });
  return parts;
};

const RestartInfoCard: React.FC<{ status: ContainerStatus }> = ({ status }) => {
  const restarts = status.restartCount ?? 0;
  const lastTerminated = status.lastState?.terminated;
  const waiting = status.state?.waiting;

  if (!lastTerminated && !waiting) return null;

  // Determine severity based on *why* it restarted, not just how many times
  const isHealthyExit = lastTerminated?.reason === "Completed" && lastTerminated?.exitCode === 0;
  const isCurrentlyFailing = !!waiting?.reason; // CrashLoopBackOff, etc.
  const hasErrorExit = lastTerminated != null && lastTerminated.exitCode !== 0;

  const accentColor = isCurrentlyFailing || hasErrorExit
    ? (restarts > 10 ? "error.main" : "warning.main")
    : isHealthyExit
      ? "success.main"
      : "info.main";

  const chipColor = isCurrentlyFailing || hasErrorExit
    ? (restarts > 10 ? "danger" : "warning")
    : isHealthyExit
      ? "success"
      : "primary";

  return (
    <Box
      sx={{
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.level1",
        overflow: "hidden",
        borderLeft: "3px solid",
        borderLeftColor: accentColor,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          py: 0.5,
          px: 1,
          bgcolor: "background.surface",
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Stack direction="row" gap={0.5} alignItems="center">
          <Icon name="LuRotateCw" size={14} />
          <Text sx={{ fontSize: 13 }} weight="semibold">
            Restart Info
          </Text>
        </Stack>
        <Chip
          size="xs"
          color={chipColor}
          emphasis="soft"
          sx={{ borderRadius: 1 }}
          label={`${restarts} restart${restarts !== 1 ? "s" : ""}`}
        />
      </Box>

      <Box sx={{ py: 0.75, px: 1 }}>
        {/* Current waiting state (e.g. CrashLoopBackOff) */}
        {waiting && (
          <Stack spacing={0.5} sx={{ mb: lastTerminated ? 0.75 : 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Icon name="LuAlertTriangle" size={14} />
              <Text sx={{ fontSize: 13 }} weight="semibold">Current State</Text>
              <Chip
                size="xs"
                color="warning"
                emphasis="soft"
                sx={{ borderRadius: 1 }}
                label={waiting.reason || "Waiting"}
              />
            </Stack>
            {waiting.message && (
              <Text
                sx={{
                  fontSize: 12,
                  color: "neutral.300",
                  pl: 2.75,
                  wordBreak: "break-all",
                  fontFamily: "var(--ov-font-mono, monospace)",
                }}
              >
                {waiting.message}
              </Text>
            )}
          </Stack>
        )}

        {/* Last termination details */}
        {lastTerminated && (
          <>
            {waiting && <Divider sx={{ my: 0.75 }} />}
            <Stack spacing={0.25}>
              <Text
                size="xs"
                weight="semibold"
                sx={{
                  color: "text.secondary",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontSize: 10,
                  mb: 0.25,
                }}
              >
                Last Termination
              </Text>
              {formatTerminated(lastTerminated).map((entry) => (
                <Grid container key={entry.label} spacing={0.5} sx={{ minHeight: 22 }}>
                  <Grid size={4} sx={{ display: "flex", alignItems: "center" }}>
                    <Text sx={{ fontSize: 12, color: "text.secondary" }}>{entry.label}</Text>
                  </Grid>
                  <Grid size={8} sx={{ display: "flex", alignItems: "center" }}>
                    <Text
                      sx={{
                        fontSize: 12,
                        color: entry.color || "neutral.200",
                        fontFamily: entry.label === "Message" ? "var(--ov-font-mono, monospace)" : undefined,
                        wordBreak: "break-all",
                      }}
                    >
                      {entry.value}
                    </Text>
                  </Grid>
                </Grid>
              ))}
            </Stack>
          </>
        )}
      </Box>
    </Box>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Environment variable formatting (resolves dynamic refs)
// ────────────────────────────────────────────────────────────────────────────

function formatEnvEntry(
  env: NonNullable<Container["env"]>[number],
  pod?: Pod,
  container?: Container,
): DetailsCardEntry {
  if (env.valueFrom) {
    const vf = env.valueFrom;

    if (vf.configMapKeyRef) {
      return {
        key: env.name,
        value: `${vf.configMapKeyRef.name || "?"} \u2192 ${vf.configMapKeyRef.key}`,
        icon: "LuFileText",
        ratio: [5, 7],
        endAdornment: (
          <Chip
            size="xs"
            emphasis="soft"
            color="primary"
            sx={{ borderRadius: 1, flexShrink: 0 }}
            label="ConfigMap"
          />
        ),
      };
    }

    if (vf.secretKeyRef) {
      return {
        key: env.name,
        value: `${vf.secretKeyRef.name || "?"} \u2192 ${vf.secretKeyRef.key}`,
        icon: "LuKeyRound",
        ratio: [5, 7],
        endAdornment: (
          <Chip
            size="xs"
            emphasis="soft"
            color="warning"
            sx={{ borderRadius: 1, flexShrink: 0 }}
            label="Secret"
          />
        ),
      };
    }

    if (vf.fieldRef) {
      const resolved = pod
        ? resolveFieldRef(pod, vf.fieldRef.fieldPath)
        : undefined;
      return {
        key: env.name,
        value: resolved || vf.fieldRef.fieldPath,
        icon: "LuLink2",
        ratio: [5, 7],
        endAdornment: (
          <Chip
            size="xs"
            emphasis="soft"
            color="neutral"
            sx={{ borderRadius: 1, flexShrink: 0 }}
            label={resolved ? vf.fieldRef.fieldPath : "FieldRef"}
          />
        ),
      };
    }

    if (vf.resourceFieldRef) {
      const resolved = container
        ? resolveResourceFieldRef(container, vf.resourceFieldRef.resource)
        : undefined;
      return {
        key: env.name,
        value: resolved || vf.resourceFieldRef.resource,
        icon: "LuCpu",
        ratio: [5, 7],
        endAdornment: (
          <Chip
            size="xs"
            emphasis="soft"
            color="neutral"
            sx={{ borderRadius: 1, flexShrink: 0 }}
            label={resolved ? vf.resourceFieldRef.resource : "Resource"}
          />
        ),
      };
    }

    return { key: env.name, value: "(ref)", ratio: [5, 7] };
  }

  return {
    key: env.name,
    value: env.value || "",
    ratio: [5, 7],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ContainerSlice
// ────────────────────────────────────────────────────────────────────────────

const ContainerSlice: React.FC<ContainerSliceProps> = ({
  resourceID,
  connectionID,
  container,
  status,
  type,
  pod,
  volumes,
  podCpuUsage,
  podMemoryUsage,
}) => {
  const label = typeLabel(type);
  const chipColor = typeChipColor(type);

  // ── Resource values ──
  const cpuReq = container.resources?.requests?.cpu as string | undefined;
  const cpuLim = container.resources?.limits?.cpu as string | undefined;
  const memReq = container.resources?.requests?.memory as string | undefined;
  const memLim = container.resources?.limits?.memory as string | undefined;
  const storReq = container.resources?.requests?.[
    "ephemeral-storage"
  ] as string | undefined;
  const storLim = container.resources?.limits?.[
    "ephemeral-storage"
  ] as string | undefined;

  // ── Compute usage percentages from pod-level metrics ──
  // Use request as denominator (standard for K8s resource planning), fall back to limit.
  const cpuDenomStr = cpuReq || cpuLim;
  const cpuUsagePercent =
    podCpuUsage != null && cpuDenomStr
      ? (podCpuUsage / parseCpuToMillicores(cpuDenomStr)) * 100
      : undefined;

  const memDenomStr = memReq || memLim;
  const memUsagePercent =
    podMemoryUsage != null && memDenomStr
      ? (podMemoryUsage / parseMemoryToBytes(memDenomStr)) * 100
      : undefined;

  // Format usage display strings
  const cpuUsageDisplay = podCpuUsage != null ? formatCpu(podCpuUsage) : undefined;
  const memUsageDisplay = podMemoryUsage != null ? formatMemory(podMemoryUsage) : undefined;

  const numProbes =
    +!!container.livenessProbe +
    +!!container.readinessProbe +
    +!!container.startupProbe;

  // ── Environment variables (resolved refs where possible) ──
  const envData: DetailsCardEntry[] | undefined = container.env?.map((env) =>
    formatEnvEntry(env, pod, container),
  );

  // ── Volume mounts (enriched with volume type from pod spec) ──
  const mountsData: DetailsCardEntry[] | undefined =
    container.volumeMounts?.map((vm) => {
      const volType = getVolumeType(volumes, vm.name);
      return {
        key: vm.name,
        icon: vm.readOnly ? "LuLock" : "LuPencil",
        value:
          vm.mountPath +
          (vm.subPath ? `/${vm.subPath}` : "") +
          (vm.subPathExpr ? ` (${vm.subPathExpr})` : ""),
        endAdornment: volType ? (
          <Chip
            size="xs"
            emphasis="soft"
            color={volumeTypeColor(volType)}
            sx={{ borderRadius: 1, flexShrink: 0 }}
            label={volType}
          />
        ) : undefined,
      };
    });

  return (
    <Box sx={{ py: 1, px: 1.25 }}>
      {/* ── Header: dot + name + type chip + restart count + status ── */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ mb: 1 }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: statusDotColor(status),
            flexShrink: 0,
          }}
        />
        <Text weight="semibold" size="sm" noWrap sx={{ flex: 1 }}>
          {container.name}
        </Text>
        {label && chipColor && (
          <Chip
            size="xs"
            color={chipColor}
            emphasis="soft"
            sx={{ borderRadius: 1 }}
            label={label}
          />
        )}
        {status && !!status.restartCount && (() => {
          const healthy = status.lastState?.terminated?.reason === "Completed" && status.lastState?.terminated?.exitCode === 0;
          const failing = !!status.state?.waiting?.reason || (status.lastState?.terminated != null && status.lastState.terminated.exitCode !== 0);
          const color = failing ? (status.restartCount > 10 ? "danger" : "warning") : healthy ? "success" : "primary";
          return (
            <Chip
              size="xs"
              color={color}
              emphasis="soft"
              sx={{ borderRadius: 1 }}
              label={`${status.restartCount} restart${status.restartCount !== 1 ? "s" : ""}`}
            />
          );
        })()}
        {status && <ContainerStatusDecorator status={status} />}
      </Stack>

      {/* ── Card-based sub-sections ── */}
      <Grid container spacing={0.75}>
        {/* Restart / termination info — shown when container has issues */}
        {status && (status.restartCount ?? 0) > 0 && (
          <Grid size={12}>
            <RestartInfoCard status={status} />
          </Grid>
        )}

        {/* Image / Command / Args — full width, wrapping text */}
        <Grid size={12}>
          <Box
            sx={{
              borderRadius: 1,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.level1",
              overflow: "hidden",
              p: 1,
            }}
          >
            <InfoRow
              icon="LuImage"
              label="Image"
              value={container.image || ""}
            />
            {!!container.command?.length && (
              <InfoRow
                icon="LuTerminalSquare"
                label="Command"
                value={container.command.join(" ")}
              />
            )}
            {!!container.args?.length && (
              <InfoRow
                icon="LuTerminal"
                label="Args"
                value={container.args.join(" ")}
              />
            )}
          </Box>
        </Grid>

        {/* Resources with utilization bars — full width */}
        <Grid size={12}>
          <Box
            sx={{
              borderRadius: 1,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.level1",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                py: 0.5,
                px: 1,
                bgcolor: "background.surface",
                borderBottom: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Stack direction="row" gap={0.5} alignItems="center">
                <Icon name="LuGauge" size={14} />
                <Text sx={{ fontSize: 13 }} weight="semibold">
                  Resources
                </Text>
              </Stack>
            </Box>
            <Box sx={{ py: 0.75, px: 1 }}>
              <ResourceBar
                label="CPU"
                icon="LuCpu"
                request={cpuUsageDisplay ? `${cpuUsageDisplay} / ${cpuReq || "∞"}` : (cpuReq || "None")}
                limit={cpuLim || "None"}
                usage={cpuUsagePercent}
              />
              <ResourceBar
                label="Memory"
                icon="LuMemoryStick"
                request={memUsageDisplay ? `${memUsageDisplay} / ${memReq || "∞"}` : (memReq || "None")}
                limit={memLim || "None"}
                usage={memUsagePercent}
              />
              <ResourceBar
                label="Storage"
                icon="LuHardDrive"
                request={storReq || "None"}
                limit={storLim || "None"}
              />
            </Box>
          </Box>
        </Grid>

        {/* Probes — split evenly based on count */}
        {container.readinessProbe && (
          <Grid size={numProbes > 1 ? 12 / numProbes : 12}>
            <DetailsCard
              title="Readiness Probe"
              titleSize="sm"
              data={probeEntry(container.readinessProbe)}
            />
          </Grid>
        )}
        {container.livenessProbe && (
          <Grid size={numProbes > 1 ? 12 / numProbes : 12}>
            <DetailsCard
              title="Liveness Probe"
              titleSize="sm"
              data={probeEntry(container.livenessProbe)}
            />
          </Grid>
        )}
        {container.startupProbe && (
          <Grid size={numProbes > 1 ? 12 / numProbes : 12}>
            <DetailsCard
              title="Startup Probe"
              titleSize="sm"
              data={probeEntry(container.startupProbe)}
            />
          </Grid>
        )}

        {/* Ports — full width with forwarding controls */}
        {container.ports && container.ports.length > 0 && (
          <Grid size={12}>
            <PortDetailsCard
              resourceID={resourceID}
              connectionID={connectionID}
              title="Ports"
              icon="LuNetwork"
              titleSize="sm"
              data={container.ports}
              podData={pod}
            />
          </Grid>
        )}

        {/* Environment Variables — full width */}
        {envData && envData.length > 0 && (
          <Grid size={12}>
            <DetailsCard
              title="Environment Variables"
              titleSize="sm"
              icon="LuKey"
              data={envData}
            />
          </Grid>
        )}

        {/* Volume Mounts — full width */}
        {mountsData && mountsData.length > 0 && (
          <Grid size={12}>
            <DetailsCard
              title="Volume Mounts"
              titleSize="sm"
              icon="LuHardDrive"
              data={mountsData}
            />
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

export default ContainerSlice;
