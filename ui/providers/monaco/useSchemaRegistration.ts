import { useEffect } from 'react';
import { useEditorSchemas } from '@omniviewdev/runtime';
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
  const { schemas, isLoading, error } = useEditorSchemas({
    pluginID,
    connectionID,
    enabled,
  });

  useEffect(() => {
    if (!schemas.length || !pluginID || !connectionID) return;

    schemaRegistry.register(pluginID, connectionID, schemas);

    return () => {
      schemaRegistry.unregister(pluginID, connectionID);
    };
  }, [schemas, pluginID, connectionID]);

  return { isLoading, error };
};
