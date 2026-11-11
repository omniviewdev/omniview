import { useEditorSchema } from '@omniviewdev/runtime';
import type { SchemaRequest } from '@omniviewdev/runtime';
import { useEffect, useId } from 'react';
import { schemaRegistry } from './schemaRegistry';

type UseSchemaRegistrationOptions = {
  pluginID: string;
  request: SchemaRequest | undefined;
  modelURI: string;
  language?: 'yaml' | 'json';
  enabled?: boolean;
};

/**
 * Registers one demanded result against the editor's already-stable model URI.
 * Each mounted consumer owns only its registration, including unavailable and
 * retired results; releasing it never removes another editor owner's schema.
 */
export const useSchemaRegistration = ({
  pluginID,
  request,
  modelURI,
  language = 'yaml',
  enabled = true,
}: UseSchemaRegistrationOptions) => {
  const ownerID = useId();
  const schema = useEditorSchema({ pluginID, request, enabled });
  const registrationEnabled = enabled && !!pluginID && !!request && !!modelURI;

  useEffect(() => {
    if (!registrationEnabled || !schema.result) {
      return;
    }

    schemaRegistry.register(pluginID, ownerID, modelURI, language, schema.result);
    return () => {
      schemaRegistry.unregister(pluginID, ownerID); 
    };
  }, [registrationEnabled, pluginID, ownerID, modelURI, language, schema.result]);

  return schema;
};
