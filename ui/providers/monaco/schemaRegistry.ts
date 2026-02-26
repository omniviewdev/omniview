import { monaco, monacoYaml } from './bootstrap';

/**
 * EditorSchemaEntry represents a schema registered with the registry.
 */
export interface EditorSchemaEntry {
  resourceKey: string;
  fileMatch: string;
  uri: string;
  /** URL to fetch schema from (mutually exclusive with schema) */
  url?: string;
  /** Inline JSON schema content */
  schema?: object;
  language: 'yaml' | 'json';
}

/**
 * SchemaRegistry collects editor schemas from all plugins/connections
 * and pushes updates to Monaco (YAML via monaco-yaml, JSON via jsonDefaults).
 *
 * Schemas are keyed by `pluginID:connectionID:resourceKey` to allow
 * add/remove/replace per plugin+connection pair.
 */
class SchemaRegistry {
  private schemas = new Map<string, EditorSchemaEntry[]>();
  private flushScheduled = false;
  private lastFlushedYamlSchemas: Array<{ uri: string; fileMatch: string[]; schema?: object }> = [];

  /**
   * Register schemas for a plugin + connection pair.
   * Replaces any previously registered schemas for the same pair.
   */
  register(
    pluginID: string,
    connectionID: string,
    schemas: Array<{
      resourceKey: string;
      fileMatch: string;
      uri: string;
      url?: string;
      content?: number[] | string;
      language: string;
    }>,
  ): void {
    const key = `${pluginID}:${connectionID}`;

    const entries: EditorSchemaEntry[] = schemas.map((s) => {
      const entry: EditorSchemaEntry = {
        resourceKey: s.resourceKey,
        fileMatch: s.fileMatch,
        uri: s.uri,
        language: (s.language as 'yaml' | 'json') || 'yaml',
      };

      if (s.url) {
        entry.url = s.url;
      } else if (s.content && s.content.length > 0) {
        // Go's json.Marshal encodes []byte as base64 string; Wails may
        // pass it through as-is (string) or as number[].
        try {
          let text: string;
          if (typeof s.content === 'string') {
            // base64-encoded JSON from Go
            text = atob(s.content);
          } else {
            // number[] (raw bytes)
            text = new TextDecoder().decode(new Uint8Array(s.content));
          }
          entry.schema = JSON.parse(text);
        } catch {
          // skip invalid schema content
          return null;
        }
      }

      return entry;
    }).filter((e): e is EditorSchemaEntry => e !== null);

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
  getLastFlushedYamlSchemas(): Array<{ uri: string; fileMatch: string[]; schema?: object }> {
    return this.lastFlushedYamlSchemas;
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
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
      schema?: object;
    }> = [];

    const jsonSchemas: Array<{
      uri: string;
      fileMatch: string[];
      schema?: object;
    }> = [];

    for (const entries of this.schemas.values()) {
      for (const entry of entries) {
        const schemaConfig = {
          uri: entry.url || entry.uri,
          fileMatch: [entry.fileMatch],
          ...(entry.schema ? { schema: entry.schema } : {}),
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
    monacoYaml.update({
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
        schema: s.schema as Record<string, unknown>,
      })),
    });
  }
}

export const schemaRegistry = new SchemaRegistry();

// Expose on window so plugins (which run in the same process but are
// separate build artifacts) can register schemas without importing host modules.
(window as any).__monacoSchemaRegistry = schemaRegistry;
