import { monaco, monacoYaml } from '@/providers/monaco/bootstrap';
import type { EditorSchema, SchemaDocument } from '@omniviewdev/runtime';

/**
 * EditorSchemaEntry represents a schema registered with the registry.
 */
export type EditorSchemaEntry = {
  type: string;
  fileMatch: string;
  uri: string;
  /** Inline JSON schema content */
  schema?: Record<string, unknown>;
  language: 'yaml' | 'json';
};

/**
 * SchemaRegistry collects editor schemas from all plugins/connections
 * and pushes updates to Monaco (YAML via monaco-yaml, JSON via jsonDefaults).
 *
 * Schemas are registered per plugin and access route. Shared schema documents
 * are registered once per route; each resource entry points at its declared root.
 */
class SchemaRegistry {
  private readonly schemas = new Map<string, EditorSchemaEntry[]>();
  private flushScheduled = false;
  private lastFlushedYamlSchemas: Array<{ uri: string; fileMatch: string[]; schema?: Record<string, unknown> }> = [];

  /**
   * Register schemas for a plugin + connection pair.
   * Replaces any previously registered schemas for the same pair.
   */
  register(
    pluginID: string,
    connectionID: string,
    schemas: readonly EditorSchema[],
    documents: readonly SchemaDocument[] = [],
  ): void {
    const key = `${pluginID}:${connectionID}`;

    const entries: EditorSchemaEntry[] = [];
    const registeredDocuments = new Map<string, string>();
    for (const schema of schemas) {
      if (schema.language !== 'yaml' && schema.language !== 'json') {
        continue;
      }

      let document = schema.binding.document;
      let documentURI = `${schema.uri}/document`;
      if (schema.binding.documentRef) {
        const reference = schema.binding.documentRef;
        const documentKey = JSON.stringify([reference.id, reference.revision, schema.language]);
        const existingURI = registeredDocuments.get(documentKey);
        documentURI = existingURI ?? `omniview-schema:///${encodeURIComponent(pluginID)}/${encodeURIComponent(connectionID)}/${encodeURIComponent(reference.id)}/${encodeURIComponent(reference.revision)}`;
        if (!existingURI) {
          document = documents.find((entry) => entry.reference.id === reference.id && entry.reference.revision === reference.revision)?.document;
          if (document === undefined) {
            throw new Error(`Editor schema document ${reference.id} is unavailable.`);
          }

          registeredDocuments.set(documentKey, documentURI);
        } else {
          document = undefined;
        }
      }

      if (document !== undefined) {
        entries.push({
          type: schema.type,
          fileMatch: '',
          uri: documentURI,
          language: schema.language,
          schema: document as Record<string, unknown>,
        });
      } else if (!schema.binding.documentRef || !registeredDocuments.has(JSON.stringify([
        schema.binding.documentRef.id, schema.binding.documentRef.revision, schema.language,
      ]))) {
        continue;
      }

      const root = schema.binding.root ?? '';
      entries.push({
        type: schema.type,
        fileMatch: schema.fileMatch,
        uri: schema.uri,
        language: schema.language,
        schema: { $ref: `${documentURI}${root.startsWith('#') ? root : `#${root}`}` },
      });
    }

    this.schemas.set(key, entries);
    this.scheduleFlush();
  }

  /**
   * Remove all schemas for a plugin + connection pair.
   */
  unregister(pluginID: string, connectionID: string): void {
    const key = `${pluginID}:${connectionID}`;
    if (this.schemas.delete(key)) {
      this.scheduleFlush();
    }
  }

  /**
   * Remove all schemas for a plugin (all connections).
   */
  unregisterPlugin(pluginID: string): void {
    const prefix = `${pluginID}:`;
    let changed = false;
    for (const key of this.schemas.keys()) {
      if (key.startsWith(prefix)) {
        this.schemas.delete(key);
        changed = true;
      }
    }

    if (changed) {
      this.scheduleFlush();
    }
  }

  /**
   * Returns a snapshot of all registered schemas keyed by `pluginID:connectionID`.
   */
  getSnapshot(): Record<string, EditorSchemaEntry[]> {
    const result: Record<string, EditorSchemaEntry[]> = {};
    for (const [key, entries] of this.schemas) {
      result[key] = [...entries];
    }

    return result;
  }

  /**
   * Returns all registered plugin:connection keys.
   */
  getRegisteredKeys(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Returns total schema count across all registrations.
   */
  getSchemaCount(): number {
    let count = 0;
    for (const entries of this.schemas.values()) {
      count += entries.length;
    }

    return count;
  }

  /**
   * Returns the schemas last sent to monacoYaml.update().
   */
  getLastFlushedYamlSchemas(): Array<{ uri: string; fileMatch: string[]; schema?: Record<string, unknown> }> {
    return this.lastFlushedYamlSchemas;
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }

    this.flushScheduled = true;
    // Batch updates to avoid thrashing Monaco on rapid schema registration
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    const yamlSchemas: Array<{
      uri: string;
      fileMatch: string[];
      schema?: Record<string, unknown>;
    }> = [];

    const jsonSchemas: Array<{
      uri: string;
      fileMatch: string[];
      schema?: Record<string, unknown>;
    }> = [];

    for (const entries of this.schemas.values()) {
      for (const entry of entries) {
        const schemaConfig = {
          uri: entry.uri,
          fileMatch: entry.fileMatch ? [entry.fileMatch] : [],
          ...(entry.schema !== undefined ? { schema: entry.schema } : {}),
        };

        if (entry.language === 'json') {
          jsonSchemas.push(schemaConfig);
        } else {
          yamlSchemas.push(schemaConfig);
        }
      }
    }

    // Capture for debug panel inspection
    this.lastFlushedYamlSchemas = yamlSchemas;

    // Update YAML schemas via monaco-yaml
    void monacoYaml.update({
      enableSchemaRequest: true,
      schemas: yamlSchemas,
    });

    // Update JSON schemas via Monaco's built-in JSON diagnostics
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      enableSchemaRequest: true,
      schemas: jsonSchemas.map((s) => ({
        uri: s.uri,
        fileMatch: s.fileMatch,
        schema: s.schema!,
      })),
    });
  }
}

export const schemaRegistry = new SchemaRegistry();

// Expose on window so plugins (which run in the same process but are
// separate build artifacts) can register schemas without importing host modules.
(window as any).__monacoSchemaRegistry = schemaRegistry;
