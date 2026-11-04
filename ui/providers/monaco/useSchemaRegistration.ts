import { useEditorSchemas } from '@omniviewdev/runtime';
import type { EditorSchemaAssociation, EditorSchemaDocument } from '@omniviewdev/runtime';
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { schemaRegistry } from './schemaRegistry';

type UseSchemaRegistrationOptions = {
  pluginID: string;
  connectionID: string;
  enabled?: boolean;
};

type Registration = {
  associations: readonly EditorSchemaAssociation[];
  documents: readonly EditorSchemaDocument[];
  owners: Set<object>;
};

const registrations = new Map<string, Registration>();
const emptyAssociations: readonly EditorSchemaAssociation[] = [];
const emptyDocuments: readonly EditorSchemaDocument[] = [];

/** One registration owner for host and plugin editor surfaces. */
export const useSchemaRegistration = ({ pluginID, connectionID, enabled = true }: UseSchemaRegistrationOptions) => {
  const query = useEditorSchemas({ pluginID, route: { connection: connectionID }, enabled });
  const associations = query.associations.length ? query.associations : emptyAssociations;
  const documents = query.documents.length ? query.documents : emptyDocuments;
  const { isLoading, error, refetch } = query;
  const scope = JSON.stringify([pluginID, connectionID]);
  const [applied, setApplied] = useState<{ scope: string; associations: typeof associations; documents: typeof documents; error: Error | null }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !pluginID || !connectionID || isLoading || error) {
      setApplied(undefined);
      return;
    }
    let active = true;
    const key = JSON.stringify([pluginID, connectionID]);
    const token = {};
    let registration = registrations.get(key);
    try {
      // Shared query results include the connection generation and rendered document revisions.
      // Never restore a superseded registration when an older editor releases its owner.
      if (attempt > 0 || !registration || registration.associations !== associations || registration.documents !== documents) {
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
      void schemaRegistry.whenFlushed().then(() => {
        if (active) setApplied({ scope, associations, documents, error: null });
      }, (failure: unknown) => {
        if (active) setApplied({ scope, associations, documents, error: failure instanceof Error ? failure : new Error(String(failure)) });
      });
    } catch (failure) {
      setApplied({ scope, associations, documents, error: failure instanceof Error ? failure : new Error(String(failure)) });
    }
    const owned = registration;
    return () => {
      active = false;
      owned?.owners.delete(token);
      if (owned && !owned.owners.size && registrations.get(key) === owned) {
        registrations.delete(key);
        schemaRegistry.unregister(pluginID, connectionID);
      }
    };
  }, [enabled, associations, documents, pluginID, connectionID, scope, isLoading, error, attempt]);
  const current = applied?.scope === scope && applied.associations === associations && applied.documents === documents ? applied : undefined;
  return {
    isLoading: enabled && (isLoading || !error && !current),
    error: error ?? current?.error ?? null,
    associations,
    retry: () => { setAttempt((value) => value + 1); return refetch(); },
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

declare global {
  interface Window {
    __omniviewEditorSchemaBoundary?: ComponentType<EditorSchemaBoundaryProps>;
  }
}

export function EditorSchemaBoundary({ pluginID, connectionID, resourceType, modelPath, children }: EditorSchemaBoundaryProps) {
  const { isLoading, error, associations, retry } = useSchemaRegistration({ pluginID, connectionID });
  if (isLoading) return createElement('div', { role: 'status' }, 'Loading editor schemas…');
  const unavailable = error ? `Editor schemas unavailable: ${error.message}`
    : !associations.some((association) => association.status === 'available' && (!resourceType || association.type === resourceType && !!modelPath?.startsWith(`${association.modelDirectory}/`))) ? 'No editor schema is available for this model. Completion and schema validation are unavailable.' : null;
  return createElement('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } },
    unavailable && createElement('div', { role: error ? 'alert' : 'status' }, unavailable,
      error && createElement('button', { type: 'button', onClick: () => { void retry(); } }, 'Retry editor schemas')),
    createElement('div', { style: { flex: 1, minHeight: 0 } }, children));
}

window.__omniviewEditorSchemaBoundary = EditorSchemaBoundary;
