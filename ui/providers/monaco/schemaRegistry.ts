import { monaco, monacoYaml } from '@/providers/monaco/bootstrap';
import type { EditorSchemaResult } from '@omniviewdev/runtime';

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

type MonacoSchema = {
  uri: string;
  fileMatch: string[];
  schema?: Record<string, unknown>;
};

/**
 * Owns exact editor-model schema registrations for host and plugin consumers.
 * A rendered document is shared only as schema content, never as a model grant.
 * Each plugin/owner pair controls one independently removable registration.
 */
class SchemaRegistry {
  private readonly schemas = new Map<string, { pluginID: string; entries: EditorSchemaEntry[] }>();
  private flushScheduled = false;
  private lastFlushedYamlSchemas: MonacoSchema[] = [];

  /**
   * Replace one owner's exact model registration with one coherent host result.
   * Validate available documents before replacing the owner's existing entry.
   */
  register(
    pluginID: string,
    ownerID: string,
    modelURI: string,
    language: 'yaml' | 'json',
    result: EditorSchemaResult,
  ): void {
    if (result.status !== 'available') {
      this.unregister(pluginID, ownerID);
      return;
    }

    const document = result.document;
    if (document === undefined) {
      throw new Error('Editor schema document is unavailable.');
    }

    if (!document.documentId) {
      throw new Error('Available editor schema result has no document ID.');
    }

    if (result.root === undefined) {
      throw new Error('Available editor schema result has no document root.');
    }

    const schema = (typeof document.schema === 'string' ? JSON.parse(document.schema) : document.schema) as Record<string, unknown>;
    const documentURI = `omniview-schema://catalog/${document.documentId}`;
    const key = JSON.stringify([pluginID, ownerID]);
    const entries: EditorSchemaEntry[] = [
      { type: result.type, fileMatch: '', uri: documentURI, language, schema },
      {
        type: result.type,
        fileMatch: modelURI,
        uri: `omniview-schema://editor/${encodeURIComponent(key)}`,
        language,
        schema: { $ref: documentURI + result.root },
      },
    ];
    this.schemas.set(key, { pluginID, entries });
    this.scheduleFlush();
  }

  /** Remove only the named owner's registration. */
  unregister(pluginID: string, ownerID: string): void {
    if (this.schemas.delete(JSON.stringify([pluginID, ownerID]))) {
      this.scheduleFlush();
    }
  }

  /** Retire every registration owned by this plugin. */
  unregisterPlugin(pluginID: string): void {
    let changed = false;
    for (const [key, registration] of this.schemas) {
      if (registration.pluginID === pluginID) {
        this.schemas.delete(key);
        changed = true;
      }
    }

    if (changed) {
      this.scheduleFlush();
    }
  }

  /** Diagnostic snapshot keyed by the serialized [pluginID, ownerID] pair. */
  getSnapshot(): Record<string, EditorSchemaEntry[]> {
    const snapshot: Record<string, EditorSchemaEntry[]> = {};
    for (const [key, { entries }] of this.schemas) {
      snapshot[key] = [...entries];
    }

    return snapshot;
  }

  getRegisteredKeys(): string[] {
    return Array.from(this.schemas.keys());
  }

  getSchemaCount(): number {
    let count = 0;
    for (const { entries } of this.schemas.values()) {
      count += entries.length;
    }

    return count;
  }

  /** Schemas last sent to the YAML worker, for the existing debug panel. */
  getLastFlushedYamlSchemas(): MonacoSchema[] {
    return this.lastFlushedYamlSchemas;
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }

    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    const yaml = new Map<string, MonacoSchema>();
    const json = new Map<string, MonacoSchema>();
    for (const { entries } of this.schemas.values()) {
      for (const entry of entries) {
        const languageSchemas = entry.language === 'json' ? json : yaml;
        languageSchemas.set(entry.uri, {
          uri: entry.uri,
          fileMatch: entry.fileMatch ? [entry.fileMatch] : [],
          ...(entry.schema !== undefined ? { schema: entry.schema } : {}),
        });
      }
    }

    this.lastFlushedYamlSchemas = Array.from(yaml.values());
    void monacoYaml.update({
      enableSchemaRequest: false,
      schemas: this.lastFlushedYamlSchemas,
    });
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      enableSchemaRequest: false,
      schemas: Array.from(json.values()),
    });
  }
}

export const schemaRegistry = new SchemaRegistry();

// Expose on window so plugins (which run in the same process but are
// separate build artifacts) can register schemas without importing host modules.
(window as any).__monacoSchemaRegistry = schemaRegistry;
