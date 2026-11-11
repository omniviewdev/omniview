import { skipToken, useQuery } from '@tanstack/react-query';
import { GetSchemaFields } from '../../resource/v2/client';
import type { SchemaRequest } from '../../resource/v2/domain';
import type { PathSegment } from '../../resource/v2/schema';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionGeneration } from './useConnectionGeneration';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

export interface UseSchemaFieldsOptions {
  pluginID?: string;
  request: SchemaRequest | undefined;
  /** Navigate one tier below this exact target's schema root. */
  path: readonly PathSegment[];
  enabled?: boolean;
}

/** Host-normalized navigation evidence, including applicability and truncation. */
export function useSchemaFields({
  pluginID: explicitPluginID,
  request,
  path,
  enabled = true,
}: UseSchemaFieldsOptions) {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const connectionID = request?.route.connection ?? '';
  const readinessEnabled = enabled && !!request;
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled: readinessEnabled });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const generation = useConnectionGeneration(pluginID, connectionID, readinessEnabled);
  const queryEnabled = readinessEnabled && !!pluginID && !!connectionID && !!request?.type
    && readiness.phase === 'connected' && generation !== undefined;
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'schema-fields', request, path, generation],
    queryFn: queryEnabled && request
      ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetSchemaFields(pluginID, { request, path }))
      : skipToken,
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: undefined,
  });
  const result = queryEnabled && query.isSuccess && !query.isFetching ? query.data : undefined;
  return {
    generation,
    result,
    fields: result?.fields,
    overlay: result?.overlay,
    isPending: !queryEnabled || query.isPending || query.isFetching,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  } as const;
}
