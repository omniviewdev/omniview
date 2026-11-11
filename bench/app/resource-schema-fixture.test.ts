import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemaRequest } from '../../packages/omniviewdev-runtime/src/resource/v2/domain';

const native = vi.hoisted(() => ({ handlers: new Map<string, unknown>(), call: vi.fn() }));
vi.mock('../render/harness/backend', () => ({
  emit: vi.fn(),
  handleAll: (handlers: Record<string, unknown>) => {
    for (const [name, handler] of Object.entries(handlers)) native.handlers.set(name, handler);
  },
}));
vi.mock('@omniviewdev/runtime', async () => import('../../packages/omniviewdev-runtime/src/resource/v2/value'));
vi.mock('@wailsio/runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>();
  return { ...actual, Call: { ...actual.Call, ByName: native.call } };
});
vi.mock('../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({}));
import { makePods, servePods } from '../render/fixtures/kubernetes';
import { Catalog, GetSchemaDocument, GetSchemaFields, ResolveEditorSchema, ResolveSchema } from '../../packages/omniviewdev-runtime/src/resource/v2/client';

const request: SchemaRequest = {
  route: { connection: 'bench' }, type: 'k8s:/pods',
  target: { representation: { id: 'kubernetes-json', revision: 'bench-1' } },
};

beforeEach(() => {
  native.handlers.clear();
  native.call.mockReset();
  native.call.mockImplementation(async (method: string, ...args: unknown[]) => {
    const name = method.replace('github.com/omniviewdev/omniview/backend/pkg/plugin/resource.ServiceWrapper.', 'resource/servicewrapper.');
    const handler = native.handlers.get(name);
    if (typeof handler !== 'function') throw new Error(`Unhandled fixture call: ${name}`);
    return handler(...args);
  });
  servePods(makePods(1));
});

describe('benchmark schema fixture through the current resource client', () => {
  it('returns coherent target-bound evidence without inventing a schema document', async () => {
    const catalog = await Catalog('kubernetes', { route: request.route });
    expect(catalog.types[0].representations).toEqual([request.target.representation]);
    expect(await ResolveSchema('kubernetes', request)).toEqual({ state: 'unavailable', unavailableReason: 'UNSUPPORTED' });

    const fields = await GetSchemaFields('kubernetes', { request, path: [{ Kind: 'field', Name: 'spec' }] });
    expect(fields).toEqual({
      type: request.type, target: request.target, observation: 'bench-schema-1',
      schemaState: 'unavailable', fields: [], truncated: false,
      overlay: {
        Operations: ['enumerate', 'sourceUpdates'], NativeQueryLanguages: [],
        HostEvaluation: 'unsupported', HostEvaluationCode: 'UNSUPPORTED', Validation: 'none', Unvalidated: null,
      },
    });
    expect(await ResolveEditorSchema('kubernetes', request)).toEqual({
      type: request.type, target: request.target, observation: fields.observation,
      status: 'unsupported', code: 'UNSUPPORTED',
    });
  });

  it.each([
    { ...request, route: { connection: 'another-cluster' } },
    { ...request, type: 'k8s:/secrets' },
    { ...request, target: { representation: { id: 'another-format', revision: 'bench-1' } } },
    { ...request, target: { representation: { id: 'kubernetes-json', revision: 'retired-format' } } },
    { ...request, target: { auxiliary: {
      key: 'embedded', reference: { address: { provider: 'kubernetes', authority: 'bench:bench', type: 'k8s:/pods', scope: [], id: 'pod' } },
    } } },
  ] satisfies SchemaRequest[])('rejects an unserved target instead of claiming schema absence: %j', async target => {
    await expect(ResolveEditorSchema('kubernetes', target)).rejects.toThrow('Unsupported benchmark schema target');
    await expect(GetSchemaFields('kubernetes', { request: target, path: [] })).rejects.toThrow('Unsupported benchmark schema target');
  });

  it('rejects an unserved plugin and unreferenced document', async () => {
    await expect(ResolveSchema('another-plugin', request)).rejects.toThrow('Unsupported benchmark schema target');
    await expect(GetSchemaDocument('kubernetes', { request, reference: { id: 'not-advertised', revision: '1' } }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
