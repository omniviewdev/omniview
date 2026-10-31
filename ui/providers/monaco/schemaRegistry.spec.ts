import type { EditorSchema, SchemaDocument } from '@omniviewdev/runtime';

const mocks = vi.hoisted(() => ({ yaml: vi.fn(), json: vi.fn() }));
vi.mock('@/providers/monaco/bootstrap', () => ({
  monacoYaml: { update: mocks.yaml },
  monaco: { languages: { json: { jsonDefaults: { setDiagnosticsOptions: mocks.json } } } },
}));
import { schemaRegistry } from './schemaRegistry';

async function flushMicrotasks() {
  const { promise, resolve } = Promise.withResolvers<void>();
  queueMicrotask(resolve);
  return promise;
}

const document: SchemaDocument = {
  reference: { id: 'shared', revision: 'revision-1' },
  dialect: 'https://json-schema.org/draft/2020-12/schema',
  document: { $defs: { Machine: { type: 'object' }, Disk: { type: 'object' } } },
};
function schema(type = 'native/machines', language = 'yaml'): EditorSchema {
  return {
    type, language, uri: `editor:///${type}`, fileMatch: `**/${type}/*.${language}`,
    binding: {
      state: 'available', validation: 'none', unvalidated: [],
      documentRef: document.reference, root: '/$defs/Machine',
    },
  };
}

beforeEach(async () => {
  schemaRegistry.unregisterPlugin('test');
  schemaRegistry.unregisterPlugin('other');
  await flushMicrotasks();
  mocks.yaml.mockClear();
  mocks.json.mockClear();
});

describe('canonical editor schema registry', () => {
  it('registers a shared document once and preserves each declared root', async () => {
    const machine = schema();
    const disk = schema('native/disks');
    disk.binding = { ...disk.binding, root: '#/$defs/Disk' };
    schemaRegistry.register('test', 'route', [machine, disk], [document]);
    await flushMicrotasks();
    const entries = schemaRegistry.getLastFlushedYamlSchemas();
    expect(entries).toHaveLength(3);
    const shared = entries.find((entry) => entry.fileMatch.length === 0)!;
    expect(shared.schema).toBe(document.document);
    expect(entries.find((entry) => entry.uri === machine.uri)?.schema).toEqual({ $ref: `${shared.uri}#/$defs/Machine` });
    expect(entries.find((entry) => entry.uri === disk.uri)?.schema).toEqual({ $ref: `${shared.uri}#/$defs/Disk` });
  });

  it('keeps JSON and YAML registrations separate', async () => {
    schemaRegistry.register('test', 'route', [schema(), schema('native/disks', 'json')], [document]);
    await flushMicrotasks();
    expect(schemaRegistry.getLastFlushedYamlSchemas()).toHaveLength(2);
    const options = mocks.json.mock.calls.at(-1)![0];
    expect(options.validate).toBe(true);
    expect(options.schemas).toHaveLength(2);
    expect(options.schemas[0].schema).toBe(document.document);
  });

  it('registers an inline canonical document without byte or base64 decoding', async () => {
    const inline = schema();
    inline.binding = { state: 'available', validation: 'none', unvalidated: [], document: { type: 'object' } };
    schemaRegistry.register('test', 'route', [inline]);
    await flushMicrotasks();
    expect(schemaRegistry.getLastFlushedYamlSchemas()[0].schema).toBe(inline.binding.document);
  });

  it('rejects an unavailable referenced document without replacing existing registration', () => {
    schemaRegistry.register('test', 'route', [schema()], [document]);
    expect(() => {
      schemaRegistry.register('test', 'route', [schema()]); 
    }).toThrow(/unavailable/);
    expect(schemaRegistry.getSnapshot()['test:route']).toHaveLength(2);
  });

  it('does not invent a schema for an unavailable binding', async () => {
    const unavailable = schema();
    unavailable.binding = { state: 'unavailable', validation: 'none', unvalidated: [] };
    schemaRegistry.register('test', 'route', [unavailable]);
    await flushMicrotasks();
    expect(schemaRegistry.getLastFlushedYamlSchemas()).toEqual([]);
  });

  it('replaces one route without changing another route', () => {
    schemaRegistry.register('test', 'route', [schema()], [document]);
    schemaRegistry.register('test', 'other-route', [schema()], [document]);
    schemaRegistry.register('test', 'route', [schema('native/disks')], [document]);
    expect(schemaRegistry.getSnapshot()['test:route'].at(-1)?.type).toBe('native/disks');
    expect(schemaRegistry.getSnapshot()['test:other-route'].at(-1)?.type).toBe('native/machines');
    expect(schemaRegistry.getSchemaCount()).toBe(4);
  });

  it('merges plugins and removes only the requested route or plugin', async () => {
    schemaRegistry.register('test', 'route', [schema()], [document]);
    schemaRegistry.register('test', 'other-route', [schema()], [document]);
    schemaRegistry.register('other', 'route', [schema()], [document]);
    schemaRegistry.unregister('test', 'route');
    expect(schemaRegistry.getSnapshot()['test:route']).toBeUndefined();
    schemaRegistry.unregisterPlugin('test');
    await flushMicrotasks();
    expect(schemaRegistry.getRegisteredKeys()).toEqual(['other:route']);
    expect(schemaRegistry.getLastFlushedYamlSchemas()).toHaveLength(2);
  });

  it('batches registrations into one diagnostics update', async () => {
    schemaRegistry.register('test', 'route', [schema()], [document]);
    schemaRegistry.register('other', 'route', [schema()], [document]);
    await flushMicrotasks();
    expect(mocks.yaml).toHaveBeenCalledTimes(1);
    expect(mocks.json).toHaveBeenCalledTimes(1);
  });
});
