import { useQuery } from '@tanstack/react-query';
import {
  GetProviders,
  GetProvidersForResource,
} from '../../wailsjs/go/metric/Client';
import type { metric } from '../../wailsjs/go/models';

/**
 * Hook to get all available metric providers.
 */
export const useMetricProviders = () => {
  return useQuery<metric.MetricProviderSummary[]>({
    queryKey: ['metric', 'providers'],
    queryFn: GetProviders,
    staleTime: 30_000,
  });
};

/**
 * Hook to get metric providers that support a specific resource type.
 */
export const useMetricProvidersForResource = (resourceKey: string) => {
  return useQuery<metric.MetricProviderSummary[]>({
    queryKey: ['metric', 'providers', resourceKey],
    queryFn: () => GetProvidersForResource(resourceKey),
    enabled: !!resourceKey,
    staleTime: 30_000,
  });
};
