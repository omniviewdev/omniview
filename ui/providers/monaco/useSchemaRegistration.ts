import { useEffect, useMemo } from 'react';
import { useEditorSchemas, type SchemaDocumentReference } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { schemaRegistry } from './schemaRegistry';

type UseSchemaRegistrationOptions = {
  pluginID: string;
  connectionID: string;
  enabled?: boolean;
};

/**
 * useSchemaRegistration fetches editor schemas for a plugin + connection
 * and automatically registers/unregisters them with the Monaco schema registry.
 *
 * Mount this hook in any component that renders a Monaco editor for a connection.
 * Schemas are automatically cleaned up when the component unmounts or the
 * connection changes.
 */
export const useSchemaRegistration = ({
  pluginID,
  connectionID,
  enabled = true,
}: UseSchemaRegistrationOptions) => {
  const queryClient = useQueryClient();
  const route = { connection: connectionID };
  const { schemas, isLoading, error } = useEditorSchemas({
    pluginID,
    route,
    enabled,
  });
  const references = useMemo(() => {
    const unique = new Map<string, SchemaDocumentReference>();
    for (const schema of schemas) {
      if (schema.binding.documentRef) {
        const reference = schema.binding.documentRef;
        unique.set(JSON.stringify([reference.id, reference.revision]), reference);
      }
    }
    return [...unique.values()];
  }, [schemas]);
  const documents = useQuery({
    queryKey: [pluginID, 'resource-v2', 'editor-schema-documents', route, references],
    enabled: enabled && !isLoading && !error,
    queryFn: () => Promise.all(references.map((reference) => queryClient.fetchQuery({
      queryKey: [pluginID, 'resource-v2', 'schema-document', route, reference],
      queryFn: () => ResourceClient.GetSchemaDocument(pluginID, route, reference),
      staleTime: Infinity,
    }))),
  });

  useEffect(() => {
    if (!schemas.length || !pluginID || !connectionID || !documents.data) {
      return;
    }

    schemaRegistry.register(pluginID, connectionID, schemas, documents.data);

    return () => {
      schemaRegistry.unregister(pluginID, connectionID);
    };
  }, [schemas, pluginID, connectionID, documents.data]);

  return { isLoading: isLoading || documents.isLoading, error: error ?? documents.error };
};
