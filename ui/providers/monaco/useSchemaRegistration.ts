import { useEditorSchemas } from '@omniviewdev/runtime';
import { useEffect } from 'react';
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
  const route = { connection: connectionID };
  const { schemas, documents, isLoading, error } = useEditorSchemas({
    pluginID,
    route,
    enabled,
  });

  useEffect(() => {
    if (!schemas.length || !pluginID || !connectionID) {
      return;
    }

    schemaRegistry.register(pluginID, connectionID, schemas, documents);

    return () => {
      schemaRegistry.unregister(pluginID, connectionID);
    };
  }, [schemas, pluginID, connectionID, documents]);

  return { isLoading, error };
};
