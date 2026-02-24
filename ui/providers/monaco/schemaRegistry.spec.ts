/* eslint-disable @typescript-eslint/no-explicit-any */

const mockYamlUpdate = jest.fn();
const mockSetDiagnosticsOptions = jest.fn();

jest.mock('./bootstrap', () => ({
  monacoYaml: { update: mockYamlUpdate },
  monaco: {
    languages: {
      json: {
        jsonDefaults: {
          setDiagnosticsOptions: mockSetDiagnosticsOptions,
        },
      },
    },
  },
}));

import { schemaRegistry } from './schemaRegistry';

// Helper: flush microtask queue (for queueMicrotask-based batching)
const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function makeSchema(overrides: Record<string, any> = {}) {
  return {
    resourceKey: 'core::v1::Pod',
    fileMatch: '**/core::v1::Pod/*.yaml',
    uri: 'k8s://test-cluster/core/v1/Pod',
    language: 'yaml',
    ...overrides,
  };
}

describe('SchemaRegistry', () => {
  beforeEach(() => {
    mockYamlUpdate.mockClear();
    mockSetDiagnosticsOptions.mockClear();
    schemaRegistry.unregister('test-plugin', 'conn-1');
    schemaRegistry.unregister('test-plugin', 'conn-2');
    schemaRegistry.unregister('other-plugin', 'conn-1');
  });

  it('registers schemas and flushes to monaco-yaml', async () => {
    schemaRegistry.register('test-plugin', 'conn-1', [makeSchema()]);
    await flushMicrotasks();

    expect(mockYamlUpdate).toHaveBeenCalledTimes(1);
    const call = mockYamlUpdate.mock.calls[0][0];
    expect(call.enableSchemaRequest).toBe(true);
    expect(call.schemas).toHaveLength(1);
    expect(call.schemas[0].uri).toBe('k8s://test-cluster/core/v1/Pod');
    expect(call.schemas[0].fileMatch).toEqual(['**/core::v1::Pod/*.yaml']);
  });

  it('registers JSON schemas and flushes to jsonDefaults', async () => {
    mockSetDiagnosticsOptions.mockClear();

    schemaRegistry.register('test-plugin', 'conn-1', [
      makeSchema({ language: 'json', uri: 'json://test/schema' }),
    ]);
    await flushMicrotasks();

    expect(mockSetDiagnosticsOptions).toHaveBeenCalled();
    const lastCall = mockSetDiagnosticsOptions.mock.calls[mockSetDiagnosticsOptions.mock.calls.length - 1][0];
    expect(lastCall.validate).toBe(true);
    expect(lastCall.schemas).toHaveLength(1);
    expect(lastCall.schemas[0].uri).toBe('json://test/schema');
  });

  it('replaces schemas for the same plugin+connection on re-register', async () => {
    schemaRegistry.register('test-plugin', 'conn-1', [makeSchema()]);
    await flushMicrotasks();

    schemaRegistry.register('test-plugin', 'conn-1', [
      makeSchema({ uri: 'k8s://updated/schema' }),
    ]);
    await flushMicrotasks();

    const lastCall = mockYamlUpdate.mock.calls[mockYamlUpdate.mock.calls.length - 1][0];
    expect(lastCall.schemas).toHaveLength(1);
    expect(lastCall.schemas[0].uri).toBe('k8s://updated/schema');
  });

  it('merges schemas from multiple plugins', async () => {
    schemaRegistry.register('test-plugin', 'conn-1', [makeSchema()]);
    schemaRegistry.register('other-plugin', 'conn-1', [
      makeSchema({ uri: 'k8s://other/schema', fileMatch: '**/apps::v1::Deployment/*.yaml' }),
    ]);
    await flushMicrotasks();

    const lastCall = mockYamlUpdate.mock.calls[mockYamlUpdate.mock.calls.length - 1][0];
    expect(lastCall.schemas).toHaveLength(2);
  });

  it('unregisters schemas for a plugin+connection', async () => {
    schemaRegistry.register('test-plugin', 'conn-1', [makeSchema()]);
    await flushMicrotasks();

    schemaRegistry.unregister('test-plugin', 'conn-1');
    await flushMicrotasks();

    const lastCall = mockYamlUpdate.mock.calls[mockYamlUpdate.mock.calls.length - 1][0];
    expect(lastCall.schemas).toHaveLength(0);
  });

  it('unregisterPlugin removes all connections for a plugin', async () => {
    schemaRegistry.register('test-plugin', 'conn-1', [makeSchema()]);
    schemaRegistry.register('test-plugin', 'conn-2', [
      makeSchema({ uri: 'k8s://other-conn/schema' }),
    ]);
    await flushMicrotasks();

    schemaRegistry.unregisterPlugin('test-plugin');
    await flushMicrotasks();

    const lastCall = mockYamlUpdate.mock.calls[mockYamlUpdate.mock.calls.length - 1][0];
    expect(lastCall.schemas).toHaveLength(0);
  });

  it('decodes inline content from byte array', async () => {
    const schemaObj = { type: 'object', properties: { name: { type: 'string' } } };
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(schemaObj)));

    schemaRegistry.register('test-plugin', 'conn-1', [
      makeSchema({ content: bytes, url: undefined }),
    ]);
    await flushMicrotasks();

    const lastCall = mockYamlUpdate.mock.calls[mockYamlUpdate.mock.calls.length - 1][0];
    expect(lastCall.schemas[0].schema).toEqual(schemaObj);
  });

  it('uses url field when present instead of uri', async () => {
    schemaRegistry.register('test-plugin', 'conn-1', [
      makeSchema({ url: 'https://example.com/schema.json' }),
    ]);
    await flushMicrotasks();

    const lastCall = mockYamlUpdate.mock.calls[mockYamlUpdate.mock.calls.length - 1][0];
    expect(lastCall.schemas[0].uri).toBe('https://example.com/schema.json');
  });

  it('skips schemas with invalid content bytes', async () => {
    const invalidBytes = [0xFF, 0xFE]; // not valid JSON

    schemaRegistry.register('test-plugin', 'conn-1', [
      makeSchema({ content: invalidBytes }),
    ]);
    await flushMicrotasks();

    const lastCall = mockYamlUpdate.mock.calls[mockYamlUpdate.mock.calls.length - 1][0];
    expect(lastCall.schemas).toHaveLength(0);
  });

  it('batches multiple register calls into a single flush', async () => {
    const callsBefore = mockYamlUpdate.mock.calls.length;

    schemaRegistry.register('test-plugin', 'conn-1', [makeSchema()]);
    schemaRegistry.register('test-plugin', 'conn-2', [
      makeSchema({ uri: 'k8s://conn2/schema' }),
    ]);

    await flushMicrotasks();

    expect(mockYamlUpdate.mock.calls.length - callsBefore).toBe(1);
    const lastCall = mockYamlUpdate.mock.calls[mockYamlUpdate.mock.calls.length - 1][0];
    expect(lastCall.schemas).toHaveLength(2);
  });
});
