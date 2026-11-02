import { useMemo, useSyncExternalStore } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { GetEditorSchemaDocument, GetEditorSchemas } from '../../resource/v2/client';
import type { EditorSchemaDocument } from '../../resource/v2/schema';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';
import { connectionReadinessStore, getConnectionReadinessGeneration } from '../../connection/connectionReadiness';

const inactiveGenerationStore = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
};

type UseEditorSchemasOptions = {
  /** The plugin ID to fetch schemas for */
  pluginID?: string;
  /** Route used to acquire schemas; never resource identity. */
  route: AccessRoute;
  /** Whether to enable the query */
  enabled?: boolean;
};

/**
 * useEditorSchemas fetches host-derived editor schema associations for a
 * plugin + connection pair, then each unique available rendered document once.
 *
 * Associations and documents are published together; callers pass both to the
 * host SchemaRegistry.
 */
export const useEditorSchemas = ({
  pluginID: explicitPluginID,
  route,
  enabled = true,
}: UseEditorSchemasOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled });
  const guardQuery = useConnectionQueryGuard(pluginID, route.connection);
  const generationStore = useMemo(() => enabled && pluginID && route.connection ? {
    subscribe: connectionReadinessStore(pluginID, route.connection).subscribe,
    getSnapshot: () => getConnectionReadinessGeneration(pluginID, route.connection),
  } : inactiveGenerationStore, [enabled, pluginID, route.connection]);
  const generation = useSyncExternalStore(generationStore.subscribe, generationStore.getSnapshot, generationStore.getSnapshot);
  const queryEnabled = enabled && !!pluginID && !!route.connection && readiness.phase === 'connected';
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'editor-schemas', route, generation],
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, async () => {
      const associations = await guardQuery(queryKey, signal, () => GetEditorSchemas(pluginID, route));
      const documents: EditorSchemaDocument[] = [];
      const resolved = new Set<string>();
      for (const association of associations) {
        const documentId = association.documentId;
        if (association.status !== 'available' || !documentId || resolved.has(documentId)) continue;
        documents.push(await queryClient.fetchQuery({
          queryKey: [pluginID, 'resource-v2', 'editor-schema-document', route, documentId, generation],
          queryFn: ({ signal: documentSignal, queryKey }) => guardQuery(queryKey, AbortSignal.any([signal, documentSignal]), () => GetEditorSchemaDocument(pluginID, route, documentId)),
          staleTime: Infinity,
        }));
        resolved.add(documentId);
      }
      return { associations, documents };
    }) : skipToken,
    enabled: queryEnabled,
    staleTime: 10 * 60 * 1000, // associations are stable per connection catalog
    retry: 1,
  });

  return {
    associations: queryEnabled ? query.data?.associations ?? [] : [],
    documents: queryEnabled ? query.data?.documents ?? [] : [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

export default useEditorSchemas;
