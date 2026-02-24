import React from "react";

// @omniviewdev/ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { Pod } from "kubernetes-types/core/v1";
import { DrawerContext, useResourceMetrics } from "@omniviewdev/runtime";

// sections
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import PodStatusSection from "./PodStatusSection";
import PodConfigSection from "./PodConfigSection";
import PodContainersSection from "./PodContainersSection";
import PodVolumesSection from "./PodVolumesSection";

interface Props {
  ctx: DrawerContext<Pod>;
}

export const PodSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const pod = ctx.data;
  const connectionID = ctx.resource?.connectionID || "";
  const resourceID = ctx.resource?.id || "";

  // Fetch live CPU/memory metrics for this pod.
  // Request both metrics-server and Prometheus IDs — whichever is available responds.
  const { data: metricsData } = useResourceMetrics({
    pluginID: "kubernetes",
    connectionID,
    resourceKey: "core::v1::Pod",
    resourceID,
    resourceNamespace: pod.metadata?.namespace,
    metricIDs: [
      "cpu_usage", "memory_usage",                         // metrics-server
      "prom_cpu_usage_rate", "prom_memory_working_set",    // prometheus
    ],
    shape: 0, // CURRENT
    refreshInterval: 15_000,
    enabled: !!connectionID && !!resourceID,
  });

  // Extract aggregate CPU/memory from the first provider's results.
  // Handle both metrics-server IDs and Prometheus IDs.
  const CPU_IDS = new Set(["cpu_usage", "prom_cpu_usage_rate"]);
  const MEM_IDS = new Set(["memory_usage", "prom_memory_working_set"]);

  let podCpuUsage: number | undefined;
  let podMemoryUsage: number | undefined;

  if (metricsData) {
    for (const resp of Object.values(metricsData)) {
      if (!resp?.success || !resp.results) continue;
      for (const result of resp.results) {
        const mid = result.current_value?.metric_id ?? "";
        if (CPU_IDS.has(mid) && podCpuUsage == null) {
          // prom_cpu_usage_rate is in cores from single-pod queries — convert to millicores
          const raw = result.current_value!.value;
          podCpuUsage = mid === "prom_cpu_usage_rate" ? raw * 1000 : raw;
        } else if (MEM_IDS.has(mid) && podMemoryUsage == null) {
          podMemoryUsage = result.current_value!.value;
        }
      }
      if (podCpuUsage != null && podMemoryUsage != null) break;
    }
  }

  return (
    <Stack direction="column" width="100%" spacing={2}>
      {/* Pod details — tightly grouped */}
      <Stack direction="column" spacing={0.5}>
        <MetadataSection data={pod.metadata} />
        <PodStatusSection pod={pod} />
        <PodConfigSection pod={pod} />
      </Stack>

      {/* Containers — separated by section heading */}
      <PodContainersSection
        resourceID={resourceID}
        connectionID={connectionID}
        obj={pod}
        podCpuUsage={podCpuUsage}
        podMemoryUsage={podMemoryUsage}
      />

      {/* Volumes — separated by section heading */}
      <PodVolumesSection pod={pod} />
    </Stack>
  );
};

PodSidebar.displayName = "PodSidebar";
export default PodSidebar;
