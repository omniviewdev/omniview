import { useMemo, useSyncExternalStore } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { GetSchemaFields } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import type { EditorSchemaAssociation, PathSegment } from '../../resource/v2/schema';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';
import { connectionReadinessStore, getConnectionReadinessGeneration } from '../../connection/connectionReadiness';
import { useEditorSchemas } from './useEditorSchemas';

const inactiveGenerationStore = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
};

type UseSchemaFieldsOptions = {
  pluginID?: string;
  /** Route used to acquire the catalog; never resource identity. */
  route: AccessRoute;
  type: string;
  /** Omitted selects the type's default representation. */
  representation?: string;
  /** Navigation path from the representation schema root. */
  path: readonly PathSegment[];
  enabled?: boolean;
};

/**
 * useSchemaFields lists catalog-derived fields one tier below `path`, with the
 * type's evaluation overlay.
 */
export const useSchemaFields = ({
  pluginID: explicitPluginID,
  route,
  type,
  representation,
  path,
  enabled = true,
}: UseSchemaFieldsOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled });
  const guardQuery = useConnectionQueryGuard(pluginID, route.connection);
  const generationStore = useMemo(() => enabled && pluginID && route.connection ? {
    subscribe: connectionReadinessStore(pluginID, route.connection).subscribe,
    getSnapshot: () => getConnectionReadinessGeneration(pluginID, route.connection),
  } : inactiveGenerationStore, [enabled, pluginID, route.connection]);
  const generation = useSyncExternalStore(generationStore.subscribe, generationStore.getSnapshot, generationStore.getSnapshot);
  const queryEnabled = enabled && !!pluginID && !!route.connection && !!type && readiness.phase === 'connected';
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'schema-fields', route, type, representation ?? '', path, generation],
    queryFn: queryEnabled
      ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetSchemaFields(pluginID, { route, type, representation, path }))
      : skipToken,
    enabled: queryEnabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    placeholderData: undefined,
  });
  return {
    result: queryEnabled ? query.data : undefined,
    fields: queryEnabled ? query.data?.fields ?? [] : [],
    overlay: queryEnabled ? query.data?.overlay : undefined,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

/** Monaco model path inside an association's host-derived model directory. */
export const editorModelPath = (association: Pick<EditorSchemaAssociation, 'modelDirectory' | 'language'>, name: string) =>
  `${association.modelDirectory}/${encodeURIComponent(name)}.${association.language}`;

type UseResourceEditorModelPathOptions = {
  pluginID?: string;
  route: AccessRoute;
  type: string;
  /** Omitted matches the catalog association (default representation) for the type. */
  representation?: string;
  /** Auxiliary schema key; when set, matches the auxiliary association instead. */
  key?: string;
  name: string;
  enabled?: boolean;
};

/**
 * useResourceEditorModelPath returns the Monaco model path whose host-derived
 * directory binds the type's editor schema, or undefined while loading or when
 * no association matches.
 */
export const useResourceEditorModelPath = ({ pluginID, route, type, representation, key, name, enabled = true }: UseResourceEditorModelPathOptions): string | undefined => {
  const { associations } = useEditorSchemas({ pluginID, route, enabled });
  const association = associations.find((candidate) => {
    if (candidate.type !== type) return false;
    if (key !== undefined) return candidate.key === key;
    if (candidate.key) return false;
    return representation === undefined || candidate.representation === representation;
  });
  return association ? editorModelPath(association, name) : undefined;
};
