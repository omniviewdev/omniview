import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { QueryAll } from '../../wailsjs/go/metric/Client';
import type { metric } from '../../wailsjs/go/models';
import { useMetricProvidersForResource } from './useMetricProviders';
import { useResolvedPluginId } from '../useResolvedPluginId';

export type UseResourceMetricsOptions = {
  /** The plugin that owns the resource (e.g., "kubernetes") */
  pluginID?: string;
  /** The connection to query metrics for */
  connectionID: string;
  /** The resource type key (e.g., "core::v1::Pod") */
  resourceKey: string;
  /** The resource instance ID (e.g., pod name) */
  resourceID: string;
  /** The resource namespace (optional) */
  resourceNamespace?: string;
  /** The full resource data object */
  resourceData?: Record<string, unknown>;
  /** Specific metric IDs to fetch (empty = all) */
  metricIDs?: string[];
  /** The shape of metric data to request */
  shape?: number;
  /** Time range for timeseries data */
  timeRange?: { start: Date; end: Date; step: string };
  /** Auto-refresh interval in milliseconds (0 = disabled) */
  refreshInterval?: number;
  /** Whether the query is enabled */
  enabled?: boolean;
};

export type UseResourceMetricsResult = {
  /** Metric results keyed by provider plugin ID */
  data: Record<string, metric.QueryResponse> | undefined;
  /** Available metric providers for this resource type */
  providers: metric.MetricProviderSummary[];
  /** Whether any query is currently loading */
  isLoading: boolean;
  /** Error from the query, if any */
  error: Error | null;
  /** Manually refetch metrics */
  refetch: () => void;
};

/**
 * Hook to query metrics from all available providers for a resource.
 * Automatically discovers providers and aggregates results.
 */
export const useResourceMetrics = (
  opts: UseResourceMetricsOptions,
): UseResourceMetricsResult => {
  const {
    connectionID,
    resourceKey,
    resourceID,
    resourceNamespace = '',
    resourceData = {},
    metricIDs = [],
    shape = 0, // CURRENT
    timeRange,
    refreshInterval = 0,
    enabled = true,
  } = opts;

  const {
    data: providersRaw,
    isLoading: providersLoading,
  } = useMetricProvidersForResource(resourceKey);

  // Guard against null — Go nil slices serialize as JSON null, and
  // destructuring defaults only apply for undefined, not null.
  const providers = providersRaw ?? [];

  // Calculate a sensible step from the time range (~250 data points).
  // Step is passed as nanoseconds to the Go backend.
  const stepNs = timeRange
    ? Math.max(
        Math.floor((timeRange.end.getTime() - timeRange.start.getTime()) / 250),
        15000,
      ) * 1_000_000
    : 0;

  const metricsQuery = useQuery<Record<string, metric.QueryResponse>>({
    queryKey: [
      'metric',
      'query',
      connectionID,
      resourceKey,
      resourceID,
      resourceNamespace,
      metricIDs,
      shape,
      timeRange?.start?.getTime(),
      timeRange?.end?.getTime(),
    ],
    queryFn: () =>
      QueryAll(
        connectionID,
        resourceKey,
        resourceID,
        resourceNamespace,
        resourceData as Record<string, any>,
        metricIDs,
        shape,
        timeRange?.start ?? new Date(0),
        timeRange?.end ?? new Date(0),
        stepNs,
      ),
    enabled: enabled && !!connectionID && !!resourceKey && (resourceKey.startsWith('cluster::') || !!resourceID) && providers.length > 0,
    refetchInterval: refreshInterval > 0 ? refreshInterval : undefined,
    staleTime: 5_000,
    // Keep previous data visible while fetching new data (e.g. on time range change)
    // to prevent the chart from blinking empty.
    placeholderData: keepPreviousData,
  });

  return {
    data: metricsQuery.data ?? undefined,
    providers,
    isLoading: providersLoading || metricsQuery.isLoading,
    error: metricsQuery.error as Error | null,
    refetch: metricsQuery.refetch,
  };
};
