import { useEditorSchemas } from '@omniviewdev/runtime';
import type { EditorSchemaAssociation, EditorSchemaDocument } from '@omniviewdev/runtime';
import { useEffect } from 'react';
import { schemaRegistry } from './schemaRegistry';

type UseSchemaRegistrationOptions = {
  pluginID: string;
  connectionID: string;
  enabled?: boolean;
};

type Registration = {
  associations: readonly EditorSchemaAssociation[];
  documents: readonly EditorSchemaDocument[];
};

const registrations = new Map<string, Registration[]>();

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
  const { associations, documents, isLoading, error } = useEditorSchemas({
    pluginID,
    route,
    enabled,
  });

  useEffect(() => {
    if (!associations.length || !pluginID || !connectionID) {
      return;
    }

    const key = JSON.stringify([pluginID, connectionID]);
    const owners = registrations.get(key) ?? [];
    const registration = { associations, documents };
    schemaRegistry.register(pluginID, connectionID, associations, documents);
    owners.push(registration);
    registrations.set(key, owners);

    return () => {
      const index = owners.indexOf(registration);
      if (index < 0) return;
      const wasCurrent = index === owners.length - 1;
      owners.splice(index, 1);
      if (!owners.length) {
        registrations.delete(key);
        schemaRegistry.unregister(pluginID, connectionID);
      } else if (wasCurrent) {
        const current = owners[owners.length - 1];
        schemaRegistry.register(pluginID, connectionID, current.associations, current.documents);
      }
    };
  }, [associations, pluginID, connectionID, documents]);

  return { isLoading, error };
};
