import { useEditorSchemas } from '@omniviewdev/runtime';
import type { EditorSchemaAssociation, EditorSchemaDocument } from '@omniviewdev/runtime';
import { createElement, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { schemaRegistry } from './schemaRegistry';

type UseSchemaRegistrationOptions = {
  pluginID: string;
  connectionID: string;
  enabled?: boolean;
};

type Registration = {
  associations: readonly EditorSchemaAssociation[];
  documents: readonly EditorSchemaDocument[];
  owners: Set<symbol>;
};

const registrations = new Map<string, Registration>();
const emptyAssociations: readonly EditorSchemaAssociation[] = [];
const emptyDocuments: readonly EditorSchemaDocument[] = [];

type RegistrationIdentity = {
  scope: string;
  associations: readonly EditorSchemaAssociation[];
  documents: readonly EditorSchemaDocument[];
  enabled: boolean;
  isLoading: boolean;
  error: unknown;
  attempt: number;
};

/** One registration owner for host and plugin editor surfaces. */
export const useSchemaRegistration = ({ pluginID, connectionID, enabled = true }: UseSchemaRegistrationOptions) => {
  const query = useEditorSchemas({ pluginID, route: { connection: connectionID }, enabled });
  const associations = query.associations.length ? query.associations : emptyAssociations;
  const documents = query.documents.length ? query.documents : emptyDocuments;
  const { isLoading, error, refetch } = query;
  const scope = JSON.stringify([pluginID, connectionID]);
  const [applied, setApplied] = useState<{ identity: RegistrationIdentity; error: Error | null }>();
  const [attempt, setAttempt] = useState(0);
  const identity = useMemo(() => ({ scope, associations, documents, enabled, isLoading, error, attempt }),
    [scope, associations, documents, enabled, isLoading, error, attempt]);

  useEffect(() => {
    if (!enabled || !pluginID || !connectionID || isLoading || error) {
      return;
    }

    let active = true;
    const key = JSON.stringify([pluginID, connectionID]);
    const token = Symbol();
    let registration = registrations.get(key);
    const apply = async () => {
      try {
        // Shared query results include the connection generation and rendered document revisions.
        // Never restore a superseded registration when an older editor releases its owner.
        if (attempt > 0 || registration?.associations !== associations || registration.documents !== documents) {
          schemaRegistry.register(pluginID, connectionID, associations, documents);
          if (registration) {
            registration.associations = associations;
            registration.documents = documents;
          } else {
            registration = { associations, documents, owners: new Set() };
            registrations.set(key, registration);
          }
        }

        registration.owners.add(token);
        await schemaRegistry.whenFlushed();
        if (active) {
          setApplied({ identity, error: null });
        }
      } catch (failure) {
        if (active) {
          setApplied({ identity, error: failure instanceof Error ? failure : new Error(String(failure)) });
        }
      }
    };

    void apply();

    const owned = registration;

    return () => {
      active = false;
      owned?.owners.delete(token);
      if (owned && !owned.owners.size && registrations.get(key) === owned) {
        registrations.delete(key);
        schemaRegistry.unregister(pluginID, connectionID);
      }
    };
  }, [enabled, associations, documents, pluginID, connectionID, scope, isLoading, error, attempt, identity]);
  const current = applied?.identity === identity ? applied : undefined;

  return {
    isLoading: enabled && (isLoading || !error && !current),
    error: error ?? current?.error ?? null,
    associations,
    retry: async () => {
      setAttempt((value) => value + 1);
      return refetch();
    },
  };
};

/** Lifecycle slot shared across separately bundled host and plugin React trees. */
export type EditorSchemaBoundaryProps = {
  pluginID: string;
  connectionID: string;
  resourceType?: string;
  modelPath?: string;
  children: ReactNode;
};

export const editorSchemaBridge = window as Window & {
  __omniviewEditorSchemaBoundary?: ComponentType<EditorSchemaBoundaryProps>;
};

export function EditorSchemaBoundary({ pluginID, connectionID, resourceType, modelPath, children }: EditorSchemaBoundaryProps) {
  const { isLoading, error, associations, retry } = useSchemaRegistration({ pluginID, connectionID });
  if (isLoading) {
    return createElement('div', { role: 'status' }, 'Loading editor schemas…');
  }

  const unavailable = error ? `Editor schemas unavailable: ${error.message}`
    : !associations.some((association) => association.status === 'available' && (!resourceType || association.type === resourceType && !!modelPath?.startsWith(`${association.modelDirectory}/`))) ? 'No editor schema is available for this model. Completion and schema validation are unavailable.' : null;

  return createElement('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } },
    unavailable && createElement('div', { role: error ? 'alert' : 'status' }, unavailable,
      error && createElement('button', { type: 'button', onClick: () => {
        void retry();
      } }, 'Retry editor schemas')),
    createElement('div', { style: { flex: 1, minHeight: 0 } }, children));
}

editorSchemaBridge.__omniviewEditorSchemaBoundary = EditorSchemaBoundary;
