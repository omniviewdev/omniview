import type { EditorSchemaDocument, EditorSchemaResult } from '@omniviewdev/runtime';

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
const firstURI = 'file:///editors/first.yaml';
const secondURI = 'file:///editors/second.yaml';
function schema(type = 'native/machines', root = '#/definitions/n1'): EditorSchemaResult {
  return {
    type,
    target: { representation: { id: 'native', revision: 'format-1' } },
    observation: 'schema-observation-1',
    status: 'available',
    document,
    root,
  };
}

beforeEach(async () => {
  schemaRegistry.unregisterPlugin('test');
  schemaRegistry.unregisterPlugin('other');
  await flushMicrotasks();
  mocks.yaml.mockClear();
  mocks.json.mockClear();
});

describe('targeted editor schema registry', () => {
  it('shares rendered content without granting any model beyond each exact URI', async () => {
    schemaRegistry.register('test', 'machine', firstURI, 'yaml', schema());
    schemaRegistry.register('test', 'disk', secondURI, 'yaml', schema('native/disks', '#/definitions/n2'));
    await flushMicrotasks();
    const entries = schemaRegistry.getLastFlushedYamlSchemas();
    expect(entries).toHaveLength(3);
    const shared = entries.find((entry) => entry.fileMatch.length === 0)!;
    expect(shared.uri).toBe(`omniview-schema://catalog/${document.documentId}`);
    expect(shared.schema).toBe(document.schema);
    expect(entries.flatMap((entry) => entry.fileMatch)).toEqual([firstURI, secondURI]);
    expect(entries.find((entry) => entry.fileMatch.includes(firstURI))?.schema)
      .toEqual({ $ref: shared.uri + '#/definitions/n1' });
    expect(entries.find((entry) => entry.fileMatch.includes(secondURI))?.schema)
      .toEqual({ $ref: shared.uri + '#/definitions/n2' });
  });

  it('keeps JSON and YAML registrations separate', async () => {
    schemaRegistry.register('test', 'yaml-owner', firstURI, 'yaml', schema());
    schemaRegistry.register('test', 'json-owner', 'file:///editors/second.json', 'json', schema('native/disks'));
    await flushMicrotasks();
    expect(schemaRegistry.getLastFlushedYamlSchemas().flatMap((entry) => entry.fileMatch)).toEqual([firstURI]);
    const options = mocks.json.mock.calls.at(-1)![0];
    expect(options.validate).toBe(true);
    expect(options.schemas).toHaveLength(2);
    expect(options.schemas.flatMap((entry: { fileMatch: string[] }) => entry.fileMatch))
      .toEqual(['file:///editors/second.json']);
    expect(options.schemas[0].schema).toBe(document.schema);
  });

  it('rejects a missing rendered document without replacing the existing owner', () => {
    schemaRegistry.register('test', 'owner', firstURI, 'yaml', schema());
    const previous = schemaRegistry.getSnapshot();
    expect(() => {
      schemaRegistry.register('test', 'owner', secondURI, 'yaml', { ...schema(), document: undefined });
    }).toThrow(/unavailable/);
    expect(schemaRegistry.getSnapshot()).toEqual(previous);
  });

  it('rejects an available result without a document ID', () => {
    expect(() => {
      schemaRegistry.register('test', 'owner', firstURI, 'yaml', {
        ...schema(), document: { ...document, documentId: '' },
      });
    }).toThrow(/no document ID/);
  });

  it('rejects a missing root without replacing the existing owner', () => {
    schemaRegistry.register('test', 'owner', firstURI, 'yaml', schema());
    const previous = schemaRegistry.getSnapshot();
    expect(() => {
      schemaRegistry.register('test', 'owner', secondURI, 'yaml', { ...schema(), root: undefined });
    }).toThrow(/no document root/);
    expect(schemaRegistry.getSnapshot()).toEqual(previous);
  });

  it.each(['absent', 'unavailable', 'unsupported', 'invalid', 'limit'] as const)(
    'clears only its owner when the target is %s', async (status) => {
      schemaRegistry.register('test', 'first-owner', firstURI, 'yaml', schema());
      schemaRegistry.register('test', 'second-owner', secondURI, 'yaml', schema());
      schemaRegistry.register('test', 'first-owner', firstURI, 'yaml', {
        ...schema(), status, document: undefined, root: undefined,
      });
      await flushMicrotasks();
      expect(schemaRegistry.getRegisteredKeys()).toEqual([JSON.stringify(['test', 'second-owner'])]);
      expect(schemaRegistry.getLastFlushedYamlSchemas().flatMap((entry) => entry.fileMatch)).toEqual([secondURI]);
    },
  );

  it('replaces one owner without changing another owner', () => {
    schemaRegistry.register('test', 'first-owner', firstURI, 'yaml', schema());
    schemaRegistry.register('test', 'second-owner', secondURI, 'yaml', schema());
    schemaRegistry.register('test', 'first-owner', firstURI, 'yaml', schema('native/disks'));
    const snapshot = schemaRegistry.getSnapshot();
    expect(snapshot[JSON.stringify(['test', 'first-owner'])].at(-1)?.type).toBe('native/disks');
    expect(snapshot[JSON.stringify(['test', 'second-owner'])].at(-1)?.type).toBe('native/machines');
    expect(schemaRegistry.getSchemaCount()).toBe(4);
  });

  it('merges plugins and removes only the requested owner or plugin', async () => {
    schemaRegistry.register('test', 'first-owner', firstURI, 'yaml', schema());
    schemaRegistry.register('test', 'second-owner', secondURI, 'yaml', schema());
    schemaRegistry.register('other', 'first-owner', firstURI, 'yaml', schema());
    schemaRegistry.unregister('test', 'first-owner');
    expect(schemaRegistry.getSnapshot()[JSON.stringify(['test', 'first-owner'])]).toBeUndefined();
    schemaRegistry.unregisterPlugin('test');
    await flushMicrotasks();
    expect(schemaRegistry.getRegisteredKeys()).toEqual([JSON.stringify(['other', 'first-owner'])]);
    expect(schemaRegistry.getLastFlushedYamlSchemas()).toHaveLength(2);
  });

  it('batches registrations into one diagnostics update', async () => {
    schemaRegistry.register('test', 'owner', firstURI, 'yaml', schema());
    schemaRegistry.register('other', 'owner', secondURI, 'yaml', schema());
    await flushMicrotasks();
    expect(mocks.yaml).toHaveBeenCalledTimes(1);
    expect(mocks.json).toHaveBeenCalledTimes(1);
  });

  it('releases one owner without widening or removing another exact model match', async () => {
    schemaRegistry.register('test', 'first-owner', firstURI, 'yaml', schema());
    schemaRegistry.register('test', 'second-owner', secondURI, 'yaml', schema());
    schemaRegistry.unregister('test', 'first-owner');
    await flushMicrotasks();
    const matches = schemaRegistry.getLastFlushedYamlSchemas().flatMap((entry) => entry.fileMatch);
    expect(matches).toEqual([secondURI]);
    expect(matches).not.toContain(firstURI);
  });

  it('keeps a shared exact model registered until its last owner releases it', async () => {
    schemaRegistry.register('test', 'first-owner', firstURI, 'yaml', schema());
    schemaRegistry.register('test', 'second-owner', firstURI, 'yaml', schema());
    schemaRegistry.unregister('test', 'second-owner');
    await flushMicrotasks();
    expect(schemaRegistry.getLastFlushedYamlSchemas().flatMap((entry) => entry.fileMatch)).toEqual([firstURI]);
    schemaRegistry.unregister('test', 'first-owner');
    await flushMicrotasks();
    expect(schemaRegistry.getLastFlushedYamlSchemas()).toEqual([]);
  });
});
