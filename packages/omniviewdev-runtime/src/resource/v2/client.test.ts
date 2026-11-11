import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemaDocumentRequest, SchemaRequest } from './domain';
import type { HostGetRequest } from './host';

const transport = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: transport.call },
  Create: { Any: (value: unknown) => value, Nullable: (fn: unknown) => fn, Map: (_key: unknown, fn: unknown) => fn, Array: (fn: unknown) => fn },
}));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({}));
import { Catalog, Get, GetSchemaDocument, GetSchemaFields, ResolveEditorSchema, ResolveSchema } from './client';
import { setFrontendSpanRecorder, type FrontendSpanRecorder } from '../../telemetry/frontendSpans';

const request: SchemaRequest = {
  route: { connection: 'route/雪' }, type: 'opaque/type',
  target: { representation: { id: 'native/format', revision: 'format-7' } },
};
const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.ServiceWrapper';

let records: Parameters<FrontendSpanRecorder>[];
beforeEach(() => {
  transport.call.mockReset();
  records = [];
  setFrontendSpanRecorder((...args) => records.push(args));
});
afterEach(() => { setFrontendSpanRecorder(null); vi.clearAllMocks(); });

describe('target-qualified schema Wails calls', () => {
  it('passes exact target requests without extra bulk or document follow-up calls', () => {
    const pending = Object.assign(Promise.resolve({ status: 'absent' }), { cancel: vi.fn() });
    transport.call.mockReturnValue(pending);
    expect(ResolveEditorSchema('provider', request)).toBe(pending);
    expect(transport.call).toHaveBeenCalledExactlyOnceWith(`${service}.ResolveEditorSchema`, 'provider', request);
  });

  it('retains cancellable binding and field calls with their target-qualified payloads', () => {
    const pending = Object.assign(Promise.resolve({}), { cancel: vi.fn() });
    transport.call.mockReturnValue(pending);
    expect(ResolveSchema('provider', request)).toBe(pending);
    const fields = { request, path: [{ Kind: 'field' as const, Name: 'spec' }] };
    expect(GetSchemaFields('provider', fields)).toBe(pending);
    expect(transport.call.mock.calls).toEqual([
      [`${service}.ResolveSchema`, 'provider', request],
      [`${service}.GetSchemaFields`, 'provider', fields],
    ]);
  });

  it('passes the admitted target request and exact reference together to the document call', () => {
    const document: SchemaDocumentRequest = { request, reference: { id: 'shared-content', revision: 'document-3' } };
    const pending = Object.assign(Promise.resolve({}), { cancel: vi.fn() });
    transport.call.mockReturnValue(pending);
    expect(GetSchemaDocument('provider', document)).toBe(pending);
    expect(transport.call).toHaveBeenCalledExactlyOnceWith(`${service}.GetSchemaDocument`, 'provider', document);
  });

  it('passes ordinary catalog observation and explicit refresh without changing either request', () => {
    const observation = { route: request.route };
    const refresh = { route: request.route, refresh: true };
    Catalog('provider', observation);
    Catalog('provider', refresh);
    expect(transport.call.mock.calls).toEqual([
      [`${service}.Catalog`, 'provider', observation],
      [`${service}.Catalog`, 'provider', refresh],
    ]);
  });
});

describe('resource client spans', () => {
  const getRequest = { targetId: 't', request: { route: { connection: 'c' }, reference: { address: { type: 'core::v1::Pod' } }, representation: 'x' } } as unknown as HostGetRequest;

  it('records a classified failure without the error text and keeps cancel', async () => {
    const promise = Object.assign(Promise.reject({ code: 'FORBIDDEN', title: 'Denied', message: 'token=abc123' }), { cancel: vi.fn() });
    transport.call.mockReturnValue(promise);
    const result = Get('kubernetes', getRequest);
    expect(result).toBe(promise);
    expect(result.cancel).toBeTypeOf('function');
    await expect(result).rejects.toBeDefined();
    expect(records).toHaveLength(1);
    expect(records[0][0]).toBe('frontend.resource.call');
    expect(records[0][1]).toMatchObject({ operation: 'get', plugin_id: 'kubernetes', resource_type: 'core::v1::Pod', outcome: 'failure', error_class: 'FORBIDDEN' });
    expect(JSON.stringify(records)).not.toContain('abc123');
  });

  it('records a cancelled call as canceled', async () => {
    transport.call.mockReturnValue(Object.assign(Promise.reject({ type: 'CANCELLED', code: 'CANCELLED', title: 'Cancelled', message: 'x' }), { cancel: vi.fn() }));
    await expect(Get('kubernetes', getRequest)).rejects.toBeDefined();
    expect(records[0][1]).toMatchObject({ operation: 'get', outcome: 'canceled' });
    expect(records[0][4]).toBe(false);
  });

  it('records success', async () => {
    transport.call.mockReturnValue(Object.assign(Promise.resolve({}), { cancel: vi.fn() }));
    await Get('kubernetes', getRequest);
    expect(records[0][1]).toMatchObject({ operation: 'get', outcome: 'success' });
  });
});
