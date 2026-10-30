import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { GetEditorSchemas, GetSchemaDocument } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

type UseEditorSchemasOptions = {
  /** The plugin ID to fetch schemas for */
  pluginID?: string;
  /** Route used to acquire schemas; never resource identity. */
  route: AccessRoute;
  /** Whether to enable the query */
  enabled?: boolean;
};

/**
 * useEditorSchemas fetches editor schemas for a plugin + connection pair
 * from the backend via Wails bindings.
 *
 * Shared documents are fetched once per exact reference and published together
 * with the schema bindings. Callers must pass both to the host SchemaRegistry.
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
  const queryEnabled = enabled && !!pluginID && !!route.connection && readiness.phase === 'connected';
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'editor-schemas', route],
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, async () => {
      const schemas = await guardQuery(queryKey, signal, () => GetEditorSchemas(pluginID, route));
      const documents = [];
      const resolved = new Set<string>();
      for (const schema of schemas) {
        const reference = schema.binding.documentRef;
        if (!reference) continue;
        const key = JSON.stringify([reference.id, reference.revision]);
        if (resolved.has(key)) continue;
        documents.push(await queryClient.fetchQuery({
          queryKey: [pluginID, 'resource-v2', 'schema-document', route, reference],
          queryFn: ({ signal: documentSignal, queryKey }) => guardQuery(queryKey, AbortSignal.any([signal, documentSignal]), () => GetSchemaDocument(pluginID, route, reference)),
          staleTime: Infinity,
        }));
        resolved.add(key);
      }
      return { schemas, documents };
    }) : skipToken,
    enabled: queryEnabled,
    staleTime: 10 * 60 * 1000, // schemas are fairly stable per connection
    retry: 1,
  });

  return {
    schemas: query.data?.schemas ?? [],
    documents: query.data?.documents ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

export default useEditorSchemas;
