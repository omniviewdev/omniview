import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { MetricClient } from "@omniviewdev/runtime/api";
import type { metric } from "@omniviewdev/runtime/models";

export type PodMetricEntry = {
  cpuMillicores: number;
  memoryBytes: number;
};

/** Map keyed by "namespace/podName" → { cpuMillicores, memoryBytes } */
export type PodMetricsMap = Map<string, PodMetricEntry>;

// Metric IDs for CPU usage (millicores)
const CPU_METRIC_IDS = new Set(["cpu_usage", "prom_cpu_usage_rate"]);
// Metric IDs for memory usage (bytes)
const MEM_METRIC_IDS = new Set(["memory_usage", "prom_memory_working_set"]);

/**
 * Fetch CPU/memory metrics for ALL pods in one batch call.
 * Uses empty resourceID to trigger the batch endpoint on the Go side.
 * Requests both metrics-server IDs and Prometheus IDs — whichever source
 * is available will respond.
 */
export function usePodMetricsBatch(opts: {
  connectionID: string;
  /** Namespace to scope metrics to (empty = all namespaces) */
  namespace?: string;
  /** Auto-refresh interval in ms (default 30s) */
  refreshInterval?: number;
  enabled?: boolean;
}): { metricsMap: PodMetricsMap; isLoading: boolean } {
  const {
    connectionID,
    namespace = "",
    refreshInterval = 30_000,
    enabled = true,
  } = opts;

  const resourceKey = "core::v1::Pod";

  const query = useQuery<PodMetricsMap>({
    queryKey: [
      "metric",
      "pod-batch",
      connectionID,
      namespace,
    ],
    queryFn: async () => {
      const resp = await MetricClient.QueryAll(
        connectionID,
        resourceKey,
        "", // empty resourceID = batch mode
        namespace,
        {},
        // Request both metrics-server and Prometheus metric IDs.
        // The Go backend will try both sources; whichever is available responds.
        [
          "cpu_usage", "memory_usage",           // metrics-server
          "prom_cpu_usage_rate", "prom_memory_working_set", // prometheus
        ],
        0, // ShapeCurrent
        new Date(0),
        new Date(0),
        0,
      );

      const map = new Map<string, PodMetricEntry>();
      if (!resp) return map;

      // Aggregate results from all providers
      for (const providerResp of Object.values(resp)) {
        const qr = providerResp as metric.QueryResponse;
        if (!qr?.success || !qr.results) continue;

        for (const result of qr.results) {
          const cv = result.current_value;
          if (!cv?.labels) continue;

          const pod = cv.labels["pod"];
          const ns = cv.labels["namespace"];
          if (!pod) continue;

          const key = ns ? `${ns}/${pod}` : pod;
          const existing = map.get(key) ?? {
            cpuMillicores: 0,
            memoryBytes: 0,
          };

          const mid = cv.metric_id ?? "";

          if (CPU_METRIC_IDS.has(mid)) {
            // Both metrics-server and Prometheus batch return millicores
            existing.cpuMillicores = cv.value ?? 0;
          } else if (MEM_METRIC_IDS.has(mid)) {
            existing.memoryBytes = cv.value ?? 0;
          }

          map.set(key, existing);
        }
      }

      return map;
    },
    enabled: enabled && !!connectionID,
    refetchInterval: refreshInterval > 0 ? refreshInterval : undefined,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });

  return {
    metricsMap: query.data ?? new Map(),
    isLoading: query.isLoading,
  };
}
