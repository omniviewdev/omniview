import React from "react";

// @omniviewdev/ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { Node } from "kubernetes-types/core/v1";
import { DrawerContext, useResourceMetrics } from "@omniviewdev/runtime";

// sections
import MetadataSection from "../../shared/sidebar/pages/overview/sections/MetadataSection";
import NodeStatusSection from "./Node/NodeStatusSection";
import NodeSystemSection from "./Node/NodeSystemSection";
import NodeResourcesSection from "./Node/NodeResourcesSection";
import NodeTopologySection from "./Node/NodeTopologySection";
import NodeImagesSection from "./Node/NodeImagesSection";

interface Props {
  ctx: DrawerContext<Node>;
}

export const NodeSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const node = ctx.data;
  const connectionID = ctx.resource?.connectionID || "";
  const resourceID = ctx.resource?.id || "";

  // Fetch live CPU/memory metrics for this node.
  const { data: metricsData } = useResourceMetrics({
    pluginID: "kubernetes",
    connectionID,
    resourceKey: "core::v1::Node",
    resourceID,
    metricIDs: [
      "cpu_usage", "cpu_capacity", "memory_usage", "memory_capacity",
      "prom_cpu_utilization", "prom_memory_utilization",
    ],
    shape: 0, // CURRENT
    refreshInterval: 15_000,
    enabled: !!connectionID && !!resourceID,
  });

  // Extract CPU/memory values from metrics response.
  const CPU_USAGE_IDS = new Set(["cpu_usage", "prom_cpu_utilization"]);
  const CPU_CAP_IDS = new Set(["cpu_capacity"]);
  const MEM_USAGE_IDS = new Set(["memory_usage", "prom_memory_utilization"]);
  const MEM_CAP_IDS = new Set(["memory_capacity"]);

  let cpuUsage: number | undefined;
  let cpuCapacity: number | undefined;
  let memoryUsage: number | undefined;
  let memoryCapacity: number | undefined;

  if (metricsData) {
    for (const resp of Object.values(metricsData)) {
      if (!resp?.success || !resp.results) continue;
      for (const result of resp.results) {
        const mid = result.current_value?.metric_id ?? "";
        const val = result.current_value?.value;
        if (val == null) continue;

        if (CPU_USAGE_IDS.has(mid) && cpuUsage == null) cpuUsage = val;
        else if (CPU_CAP_IDS.has(mid) && cpuCapacity == null) cpuCapacity = val;
        else if (MEM_USAGE_IDS.has(mid) && memoryUsage == null) memoryUsage = val;
        else if (MEM_CAP_IDS.has(mid) && memoryCapacity == null) memoryCapacity = val;
      }
    }
  }

  return (
    <Stack direction="column" width="100%" spacing={2}>
      {/* Core details — tightly grouped */}
      <Stack direction="column" spacing={0.5}>
        <MetadataSection data={node.metadata} />
        <NodeStatusSection node={node} />
        <NodeSystemSection node={node} />
      </Stack>

      {/* Resources with live usage gauges */}
      <NodeResourcesSection
        node={node}
        cpuUsage={cpuUsage}
        cpuCapacity={cpuCapacity}
        memoryUsage={memoryUsage}
        memoryCapacity={memoryCapacity}
      />

      {/* Topology + Karpenter */}
      <NodeTopologySection node={node} />

      {/* Images */}
      <NodeImagesSection node={node} />
    </Stack>
  );
};

NodeSidebar.displayName = "NodeSidebar";
export default NodeSidebar;
