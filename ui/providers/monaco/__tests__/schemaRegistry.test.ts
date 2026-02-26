import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the bootstrap module before importing schemaRegistry
const mockUpdate = vi.fn();
const mockSetDiagnosticsOptions = vi.fn();

vi.mock('../bootstrap', () => ({
  monaco: {
    languages: {
      json: {
        jsonDefaults: {
          setDiagnosticsOptions: mockSetDiagnosticsOptions,
        },
      },
    },
  },
  monacoYaml: {
    update: mockUpdate,
  },
}));

// Import after mocks are set up
const { schemaRegistry } = await import('../schemaRegistry');

// Helper to flush microtasks so scheduleFlush() runs
const flushMicrotasks = () => new Promise<void>((r) => queueMicrotask(r));

describe('SchemaRegistry', () => {
  beforeEach(() => {
    // Clear all registrations between tests
    for (const key of schemaRegistry.getRegisteredKeys()) {
      const [pluginID, connectionID] = key.split(':');
      schemaRegistry.unregister(pluginID, connectionID);
    }
    mockUpdate.mockClear();
    mockSetDiagnosticsOptions.mockClear();
  });

  describe('register()', () => {
    it('should add schemas and reflect them in getSnapshot()', async () => {
      schemaRegistry.register('k8s', 'conn-1', [
        {
          resourceKey: 'core::v1::Pod',
          fileMatch: '**/core::v1::Pod/*.yaml',
          uri: 'k8s://conn-1/core/v1/Pod',
          language: 'yaml',
        },
      ]);

      const snapshot = schemaRegistry.getSnapshot();
      expect(snapshot['k8s:conn-1']).toHaveLength(1);
      expect(snapshot['k8s:conn-1'][0].resourceKey).toBe('core::v1::Pod');
    });

    it('should decode number[] content into a schema object', async () => {
      const schemaObj = { type: 'object', properties: { apiVersion: { type: 'string' } } };
      const content = Array.from(new TextEncoder().encode(JSON.stringify(schemaObj)));

      schemaRegistry.register('k8s', 'conn-2', [
        {
          resourceKey: 'apps::v1::Deployment',
          fileMatch: '**/apps::v1::Deployment/*.yaml',
          uri: 'k8s://conn-2/apps/v1/Deployment',
          content,
          language: 'yaml',
        },
      ]);

      const snapshot = schemaRegistry.getSnapshot();
      expect(snapshot['k8s:conn-2'][0].schema).toEqual(schemaObj);
      expect(snapshot['k8s:conn-2'][0].url).toBeUndefined();
    });

    it('should decode base64 string content (Go json.Marshal []byte format)', async () => {
      const schemaObj = { type: 'object', properties: { spec: { type: 'object' } } };
      const content = btoa(JSON.stringify(schemaObj));

      schemaRegistry.register('k8s', 'conn-b64', [
        {
          resourceKey: 'apps::v1::StatefulSet',
          fileMatch: '**/apps::v1::StatefulSet/*.yaml',
          uri: 'k8s://conn-b64/apps/v1/StatefulSet',
          content,
          language: 'yaml',
        },
      ]);

      const snapshot = schemaRegistry.getSnapshot();
      expect(snapshot['k8s:conn-b64']).toHaveLength(1);
      expect(snapshot['k8s:conn-b64'][0].schema).toEqual(schemaObj);
    });

    it('should skip entries with invalid content gracefully', async () => {
      const badContent = [0xFF, 0xFE]; // invalid JSON

      schemaRegistry.register('k8s', 'conn-3', [
        {
          resourceKey: 'core::v1::Bad',
          fileMatch: '**/core::v1::Bad/*.yaml',
          uri: 'k8s://conn-3/core/v1/Bad',
          content: badContent,
          language: 'yaml',
        },
        {
          resourceKey: 'core::v1::Good',
          fileMatch: '**/core::v1::Good/*.yaml',
          uri: 'k8s://conn-3/core/v1/Good',
          language: 'yaml',
        },
      ]);

      const snapshot = schemaRegistry.getSnapshot();
      expect(snapshot['k8s:conn-3']).toHaveLength(1);
      expect(snapshot['k8s:conn-3'][0].resourceKey).toBe('core::v1::Good');
    });

    it('should replace previous schemas for the same plugin:connection', async () => {
      schemaRegistry.register('k8s', 'conn-4', [
        {
          resourceKey: 'core::v1::Pod',
          fileMatch: '**/core::v1::Pod/*.yaml',
          uri: 'k8s://conn-4/core/v1/Pod',
          language: 'yaml',
        },
      ]);

      schemaRegistry.register('k8s', 'conn-4', [
        {
          resourceKey: 'core::v1::Service',
          fileMatch: '**/core::v1::Service/*.yaml',
          uri: 'k8s://conn-4/core/v1/Service',
          language: 'yaml',
        },
      ]);

      const snapshot = schemaRegistry.getSnapshot();
      expect(snapshot['k8s:conn-4']).toHaveLength(1);
      expect(snapshot['k8s:conn-4'][0].resourceKey).toBe('core::v1::Service');
    });
  });

  describe('unregister()', () => {
    it('should remove schemas for a plugin:connection pair', async () => {
      schemaRegistry.register('k8s', 'conn-5', [
        {
          resourceKey: 'core::v1::Pod',
          fileMatch: '**/core::v1::Pod/*.yaml',
          uri: 'k8s://conn-5/core/v1/Pod',
          language: 'yaml',
        },
      ]);

      schemaRegistry.unregister('k8s', 'conn-5');

      const snapshot = schemaRegistry.getSnapshot();
      expect(snapshot['k8s:conn-5']).toBeUndefined();
    });
  });

  describe('unregisterPlugin()', () => {
    it('should remove all connections for a plugin', async () => {
      schemaRegistry.register('k8s', 'conn-a', [
        {
          resourceKey: 'core::v1::Pod',
          fileMatch: '**/core::v1::Pod/*.yaml',
          uri: 'k8s://conn-a/core/v1/Pod',
          language: 'yaml',
        },
      ]);
      schemaRegistry.register('k8s', 'conn-b', [
        {
          resourceKey: 'apps::v1::Deployment',
          fileMatch: '**/apps::v1::Deployment/*.yaml',
          uri: 'k8s://conn-b/apps/v1/Deployment',
          language: 'yaml',
        },
      ]);
      schemaRegistry.register('other-plugin', 'conn-c', [
        {
          resourceKey: 'custom::v1::Widget',
          fileMatch: '**/custom::v1::Widget/*.yaml',
          uri: 'other://conn-c/custom/v1/Widget',
          language: 'yaml',
        },
      ]);

      schemaRegistry.unregisterPlugin('k8s');

      const keys = schemaRegistry.getRegisteredKeys();
      expect(keys).toEqual(['other-plugin:conn-c']);
    });
  });

  describe('getSchemaCount()', () => {
    it('should return total count across all registrations', async () => {
      schemaRegistry.register('k8s', 'conn-x', [
        {
          resourceKey: 'core::v1::Pod',
          fileMatch: '**/core::v1::Pod/*.yaml',
          uri: 'k8s://conn-x/core/v1/Pod',
          language: 'yaml',
        },
        {
          resourceKey: 'core::v1::Service',
          fileMatch: '**/core::v1::Service/*.yaml',
          uri: 'k8s://conn-x/core/v1/Service',
          language: 'yaml',
        },
      ]);
      schemaRegistry.register('k8s', 'conn-y', [
        {
          resourceKey: 'apps::v1::Deployment',
          fileMatch: '**/apps::v1::Deployment/*.yaml',
          uri: 'k8s://conn-y/apps/v1/Deployment',
          language: 'yaml',
        },
      ]);

      expect(schemaRegistry.getSchemaCount()).toBe(3);
    });
  });

  describe('flush()', () => {
    it('should call monacoYaml.update and jsonDefaults.setDiagnosticsOptions', async () => {
      schemaRegistry.register('k8s', 'conn-f', [
        {
          resourceKey: 'core::v1::Pod',
          fileMatch: '**/core::v1::Pod/*.yaml',
          uri: 'k8s://conn-f/core/v1/Pod',
          language: 'yaml',
        },
        {
          resourceKey: 'core::v1::ConfigMap',
          fileMatch: '**/core::v1::ConfigMap/*.json',
          uri: 'k8s://conn-f/core/v1/ConfigMap',
          language: 'json',
        },
      ]);

      await flushMicrotasks();

      expect(mockUpdate).toHaveBeenCalled();
      const yamlCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
      expect(yamlCall.schemas.length).toBeGreaterThanOrEqual(1);
      expect(yamlCall.enableSchemaRequest).toBe(true);

      expect(mockSetDiagnosticsOptions).toHaveBeenCalled();
    });

    it('should capture last flushed YAML schemas', async () => {
      schemaRegistry.register('k8s', 'conn-g', [
        {
          resourceKey: 'core::v1::Pod',
          fileMatch: '**/core::v1::Pod/*.yaml',
          uri: 'k8s://conn-g/core/v1/Pod',
          language: 'yaml',
        },
      ]);

      await flushMicrotasks();

      const flushed = schemaRegistry.getLastFlushedYamlSchemas();
      expect(flushed.length).toBeGreaterThanOrEqual(1);
      expect(flushed.some((s) => s.uri === 'k8s://conn-g/core/v1/Pod')).toBe(true);
    });
  });
});
