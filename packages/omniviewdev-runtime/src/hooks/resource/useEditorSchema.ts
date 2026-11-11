import { skipToken, useQuery } from '@tanstack/react-query';
import { ResolveEditorSchema } from '../../resource/v2/client';
import type { SchemaRequest } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionGeneration } from './useConnectionGeneration';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

export interface UseEditorSchemaOptions {
  pluginID?: string;
  /** One admitted format or exact auxiliary resource. Undefined is unrequested, not absent. */
  request: SchemaRequest | undefined;
  enabled?: boolean;
}

/** One coherent target observation and rendered document, owned by its mounted consumers. */
export function useEditorSchema({
  pluginID: explicitPluginID,
  request,
  enabled = true,
}: UseEditorSchemaOptions) {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const connectionID = request?.route.connection ?? '';
  const readinessEnabled = enabled && !!request;
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled: readinessEnabled });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const generation = useConnectionGeneration(pluginID, connectionID, readinessEnabled);
  const queryEnabled = readinessEnabled && !!pluginID && !!connectionID && !!request?.type
    && readiness.phase === 'connected' && generation !== undefined;
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'editor-schema', request, generation],
    queryFn: queryEnabled && request
      ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => ResolveEditorSchema(pluginID, request))
      : skipToken,
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: undefined,
  });

  return {
    generation,
    result: queryEnabled && query.isSuccess && !query.isFetching ? query.data : undefined,
    isPending: !queryEnabled || query.isPending || query.isFetching,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  } as const;
}
