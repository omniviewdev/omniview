import { monaco, monacoYaml } from '@/providers/monaco/bootstrap';
import type { EditorSchemaAssociation, EditorSchemaDocument } from '@omniviewdev/runtime';

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
 * Schemas are registered per plugin and access route. Host-rendered documents
 * are registered once per document ID; each available association maps its
 * model directory to the document root.
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
    associations: readonly EditorSchemaAssociation[],
    documents: readonly EditorSchemaDocument[],
  ): void {
    const key = `${pluginID}:${connectionID}`;

    const entries: EditorSchemaEntry[] = [];
    const registeredDocuments = new Set<string>();
    for (const association of associations) {
      if (association.status !== 'available') {
        continue;
      }
      if (!association.documentId) {
        throw new Error('Available editor schema association has no document ID.');
      }
      if (association.language !== 'yaml' && association.language !== 'json') {
        continue;
      }
      const documentURI = `omniview-schema:///${association.documentId}`;
      const documentKey = `${association.documentId}\u0000${association.language}`;
      if (!registeredDocuments.has(documentKey)) {
        const document = documents.find((entry) => entry.documentId === association.documentId);
        if (document === undefined) {
          throw new Error(`Editor schema document ${association.documentId} is unavailable.`);
        }
        entries.push({
          type: association.type,
          fileMatch: '',
          uri: documentURI,
          language: association.language,
          schema: (typeof document.schema === 'string' ? JSON.parse(document.schema) : document.schema) as Record<string, unknown>,
        });
        registeredDocuments.add(documentKey);
      }
      const hex16 = association.modelDirectory.slice(association.modelDirectory.lastIndexOf('/') + 1);
      entries.push({
        type: association.type,
        fileMatch: association.fileMatch,
        uri: `omniview-schema:///assoc/${hex16}`,
        language: association.language,
        schema: { $ref: `${documentURI}${association.root ?? ''}` },
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
