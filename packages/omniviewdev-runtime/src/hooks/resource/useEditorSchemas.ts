import { useQuery } from '@tanstack/react-query';
import { GetEditorSchemas } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';

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
 * The caller is responsible for registering the returned schemas with
 * the SchemaRegistry (which lives in the host app's monaco provider).
 */
export const useEditorSchemas = ({
  pluginID: explicitPluginID,
  route,
  enabled = true,
}: UseEditorSchemasOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const query = useQuery({
    queryKey: ['EDITOR_SCHEMAS', pluginID, route],
    queryFn: () => GetEditorSchemas(pluginID, route),
    enabled: enabled && !!pluginID && !!route.connection,
    staleTime: 10 * 60 * 1000, // schemas are fairly stable per connection
    retry: 1,
  });

  return {
    schemas: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

export default useEditorSchemas;
