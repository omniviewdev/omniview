import React from "react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import { Chip } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import {
  Container,
  ContainerStatus,
  Pod,
  PodSpec,
} from "kubernetes-types/core/v1";
import ContainerSlice from "./ContainerSlice";

type ContainerType = "container" | "init" | "ephemeral";

interface ParsedContainer {
  resourceID: string;
  connectionID: string;
  container: Container;
  status?: ContainerStatus;
  type: ContainerType;
}

function parseContainers(
  pod: Pod,
  resourceID: string,
  connectionID: string,
): ParsedContainer[] {
  const result: ParsedContainer[] = [];

  const containerStatusMap: Record<string, ContainerStatus> = {};
  pod.status?.containerStatuses?.forEach((cs) => {
    containerStatusMap[cs.name] = cs;
  });

  const initStatusMap: Record<string, ContainerStatus> = {};
  pod.status?.initContainerStatuses?.forEach((cs) => {
    initStatusMap[cs.name] = cs;
  });

  const ephemeralStatusMap: Record<string, ContainerStatus> = {};
  pod.status?.ephemeralContainerStatuses?.forEach((cs) => {
    ephemeralStatusMap[cs.name] = cs;
  });

  pod.spec?.initContainers?.forEach((container) => {
    result.push({
      resourceID,
      connectionID,
      container,
      status: initStatusMap[container.name],
      type: "init",
    });
  });

  pod.spec?.containers?.forEach((container) => {
    result.push({
      resourceID,
      connectionID,
      container,
      status: containerStatusMap[container.name],
      type: "container",
    });
  });

  pod.spec?.ephemeralContainers?.forEach((ec) => {
    result.push({
      resourceID,
      connectionID,
      container: ec as unknown as Container,
      status: ephemeralStatusMap[ec.name],
      type: "ephemeral",
    });
  });

  return result;
}

// ── IDE-style section heading ──
const SectionHeading: React.FC<{ label: string; count: number }> = ({
  label,
  count,
}) => (
  <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 0.75 }}>
    <Text
      size="xs"
      weight="semibold"
      sx={{
        color: "text.secondary",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontSize: 11,
        flexShrink: 0,
      }}
    >
      {label}
    </Text>
    <Chip
      size="xs"
      emphasis="outline"
      color="primary"
      sx={{ borderRadius: 1, flexShrink: 0 }}
      label={String(count)}
    />
    <Box sx={{ flex: 1, height: "1px", bgcolor: "divider" }} />
  </Stack>
);

// ── Sub-group header for init/ephemeral containers ──
const GroupHeader: React.FC<{ label: string }> = ({ label }) => (
  <Box sx={{ px: 1.25, pt: 0.75, pb: 0.25 }}>
    <Text
      size="xs"
      weight="semibold"
      sx={{
        color: "neutral.400",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {label}
    </Text>
  </Box>
);

interface ContainersSectionProps {
  resourceID: string;
  connectionID: string;
  obj: Pod;
  /** Pod-level CPU usage in millicores (from metrics-server) */
  podCpuUsage?: number;
  /** Pod-level memory usage in bytes (from metrics-server) */
  podMemoryUsage?: number;
}

const PodContainersSection: React.FC<ContainersSectionProps> = ({
  obj,
  resourceID,
  connectionID,
  podCpuUsage,
  podMemoryUsage,
}) => {
  const parsed = parseContainers(obj, resourceID, connectionID);
  if (parsed.length === 0) return null;

  const initContainers = parsed.filter((c) => c.type === "init");
  const regularContainers = parsed.filter((c) => c.type === "container");
  const ephemeralContainers = parsed.filter((c) => c.type === "ephemeral");

  return (
    <Box>
      <SectionHeading label="Containers" count={parsed.length} />
      <Box
        sx={{
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.level1",
          overflow: "hidden",
        }}
      >
        {initContainers.length > 0 && (
          <>
            <GroupHeader label="Init Containers" />
            {initContainers.map((c, i) => (
              <React.Fragment key={c.container.name}>
                {i > 0 && <Divider />}
                <ContainerSlice {...c} pod={obj} volumes={obj.spec?.volumes} podCpuUsage={podCpuUsage} podMemoryUsage={podMemoryUsage} />
              </React.Fragment>
            ))}
            {(regularContainers.length > 0 ||
              ephemeralContainers.length > 0) && <Divider />}
          </>
        )}
        {regularContainers.map((c, i) => (
          <React.Fragment key={c.container.name}>
            {i > 0 && <Divider />}
            <ContainerSlice {...c} pod={obj} volumes={obj.spec?.volumes} podCpuUsage={podCpuUsage} podMemoryUsage={podMemoryUsage} />
          </React.Fragment>
        ))}
        {ephemeralContainers.length > 0 && (
          <>
            {regularContainers.length > 0 && <Divider />}
            <GroupHeader label="Ephemeral Containers" />
            {ephemeralContainers.map((c, i) => (
              <React.Fragment key={c.container.name}>
                {i > 0 && <Divider />}
                <ContainerSlice {...c} pod={obj} volumes={obj.spec?.volumes} podCpuUsage={podCpuUsage} podMemoryUsage={podMemoryUsage} />
              </React.Fragment>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
};

export const PodContainersSectionFromPodSpec: React.FC<{
  resourceID: string;
  connectionID: string;
  spec?: PodSpec;
}> = ({ spec, resourceID, connectionID }) => {
  if (!spec?.containers) return null;

  const containers: ParsedContainer[] = [];

  spec.initContainers?.forEach((container) => {
    containers.push({ resourceID, connectionID, container, type: "init" });
  });

  spec.containers.forEach((container) => {
    containers.push({
      resourceID,
      connectionID,
      container,
      type: "container",
    });
  });

  const initContainers = containers.filter((c) => c.type === "init");
  const regularContainers = containers.filter((c) => c.type === "container");

  return (
    <Box>
      <SectionHeading label="Containers" count={containers.length} />
      <Box
        sx={{
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.level1",
          overflow: "hidden",
        }}
      >
        {initContainers.length > 0 && (
          <>
            <GroupHeader label="Init Containers" />
            {initContainers.map((c, i) => (
              <React.Fragment key={c.container.name}>
                {i > 0 && <Divider />}
                <ContainerSlice {...c} volumes={spec?.volumes} />
              </React.Fragment>
            ))}
            {regularContainers.length > 0 && <Divider />}
          </>
        )}
        {regularContainers.map((c, i) => (
          <React.Fragment key={c.container.name}>
            {i > 0 && <Divider />}
            <ContainerSlice {...c} volumes={spec?.volumes} />
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};

export default PodContainersSection;
