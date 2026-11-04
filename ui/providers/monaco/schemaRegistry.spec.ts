import type { EditorSchemaAssociation, EditorSchemaDocument } from '@omniviewdev/runtime';

const mocks = vi.hoisted(() => ({ yaml: vi.fn(), json: vi.fn() }));
vi.mock('@/providers/monaco/bootstrap', () => ({
  monacoYaml: { update: mocks.yaml },
  monaco: { languages: { json: { jsonDefaults: { setDiagnosticsOptions: mocks.json } } } },
}));
import { schemaRegistry } from './schemaRegistry';

async function flushMicrotasks() {
  await schemaRegistry.whenFlushed();
}

const document: EditorSchemaDocument = {
  documentId: 'a'.repeat(64),
  schema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions: {
      n1: { type: 'object', properties: { replicas: { $ref: '#/definitions/n3' } } },
      n2: { type: 'object', properties: { name: { type: 'string' } } },
      n3: { type: 'integer' },
    },
  },
};
let directory = 0;
function schema(type = 'native/machines', language = 'yaml', root = '#/definitions/n1'): EditorSchemaAssociation {
  const hex16 = (directory++).toString(16).padStart(16, '0');
  return {
    type, language, representation: 'native', status: 'available', documentId: document.documentId, root,
    modelDirectory: `file:///omniview-schema/${hex16}`, fileMatch: `**/omniview-schema/${hex16}/*`,
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
  it('registers a rendered document once and maps each association to its root', async () => {
    const machine = schema();
    const disk = schema('native/disks', 'yaml', '#/definitions/n2');
    schemaRegistry.register('test', 'route', [machine, disk], [document]);
    await flushMicrotasks();
    const entries = schemaRegistry.getLastFlushedYamlSchemas();
    expect(entries).toHaveLength(3);
    const shared = entries.find((entry) => entry.fileMatch.length === 0)!;
    expect(shared.uri).toBe(`omniview-schema://catalog/${document.documentId}`);
    expect(shared.schema).toBe(document.schema);
    const machineEntry = entries.find((entry) => entry.fileMatch.includes(machine.fileMatch))!;
    expect(machineEntry.uri).toBe(`omniview-schema://catalog/assoc/${machine.modelDirectory.split('/').at(-1)}`);
    expect(machineEntry.schema).toEqual({ $ref: shared.uri + '#/definitions/n1' });
    expect(entries.find((entry) => entry.fileMatch.includes(disk.fileMatch))?.schema)
      .toEqual({ $ref: shared.uri + '#/definitions/n2' });
  });

  it('keeps JSON and YAML registrations separate', async () => {
    schemaRegistry.register('test', 'route', [schema(), schema('native/disks', 'json')], [document]);
    await flushMicrotasks();
    expect(schemaRegistry.getLastFlushedYamlSchemas()).toHaveLength(2);
    const options = mocks.json.mock.calls.at(-1)![0];
    expect(options.validate).toBe(true);
    expect(options.schemas).toHaveLength(2);
    expect(options.schemas[0].schema).toBe(document.schema);
  });

  it('rejects a missing rendered document without replacing existing registration', () => {
    schemaRegistry.register('test', 'route', [schema()], [document]);
    expect(() => {
      schemaRegistry.register('test', 'route', [schema()], []);
    }).toThrow(/unavailable/);
    expect(schemaRegistry.getSnapshot()['test:route']).toHaveLength(2);
  });

  it('rejects an available association without a document ID', () => {
    expect(() => {
      schemaRegistry.register('test', 'route', [{ ...schema(), documentId: undefined }], []);
    }).toThrow(/no document ID/);
  });

  it('does not invent a schema for non-available associations', async () => {
    const statuses = ['absent', 'unavailable', 'unsupported', 'invalid', 'limit'] as const;
    schemaRegistry.register('test', 'route', statuses.map((status) => ({ ...schema(), status, documentId: undefined, root: undefined })), []);
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

  it('waits for the asynchronous YAML update before resolving whenFlushed', async () => {
    const update = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    mocks.yaml.mockImplementationOnce(() => {
      started.resolve();
      return update.promise;
    });
    schemaRegistry.register('test', 'route', [schema()], [document]);
    const flushed = schemaRegistry.whenFlushed();
    const settled = vi.fn();
    void flushed.then(settled);
    await started.promise;
    expect(settled).not.toHaveBeenCalled();
    expect(mocks.json).not.toHaveBeenCalled();
    update.resolve();
    await flushed;
    expect(settled).toHaveBeenCalledOnce();
    expect(mocks.json).toHaveBeenCalledOnce();
  });

  it('rejects whenFlushed on an asynchronous YAML failure and permits a later retry', async () => {
    const update = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const failure = new Error('YAML worker rejected update');
    mocks.yaml.mockImplementationOnce(() => {
      started.resolve();
      return update.promise;
    });
    schemaRegistry.register('test', 'route', [schema()], [document]);
    const rejection = expect(schemaRegistry.whenFlushed()).rejects.toBe(failure);
    await started.promise;
    update.reject(failure);
    await rejection;
    expect(mocks.json).not.toHaveBeenCalled();
    schemaRegistry.register('test', 'route', [schema()], [document]);
    await schemaRegistry.whenFlushed();
    expect(mocks.yaml).toHaveBeenCalledTimes(2);
    expect(mocks.json).toHaveBeenCalledOnce();
  });
});
