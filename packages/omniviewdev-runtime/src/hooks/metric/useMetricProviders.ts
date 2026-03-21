import { useQuery } from '@tanstack/react-query';
import {
  GetProviders,
  GetProvidersForResource,
} from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper';
import type { MetricProviderSummary } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';

/**
 * Hook to get all available metric providers.
 */
export const useMetricProviders = () => {
  return useQuery<MetricProviderSummary[]>({
    queryKey: ['metric', 'providers'],
    queryFn: GetProviders,
    staleTime: 30_000,
  });
};

/**
 * Hook to get metric providers that support a specific resource type.
 */
export const useMetricProvidersForResource = (resourceKey: string) => {
  return useQuery<MetricProviderSummary[]>({
    queryKey: ['metric', 'providers', resourceKey],
    queryFn: () => GetProvidersForResource(resourceKey),
    enabled: !!resourceKey,
    staleTime: 30_000,
  });
};
