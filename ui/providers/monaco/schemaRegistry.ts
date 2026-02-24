import { monaco, monacoYaml } from './bootstrap';

/**
 * EditorSchemaEntry represents a schema registered with the registry.
 */
interface EditorSchemaEntry {
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
      content?: number[];
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
        // content comes from Go as []byte → Wails serializes as number[]
        try {
          const text = new TextDecoder().decode(new Uint8Array(s.content));
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
