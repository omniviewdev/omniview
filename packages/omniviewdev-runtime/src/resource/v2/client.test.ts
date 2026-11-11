import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostGetRequest } from './host';

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@wailsio/runtime', async importOriginal => ({ ...(await importOriginal<object>()), Call: { ByName: mocks.call } }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({}));
import { Get } from './client';
import { setFrontendSpanRecorder, type FrontendSpanRecorder } from '../../telemetry/frontendSpans';

const request = { targetId: 't', request: { route: { connection: 'c' }, reference: { address: { type: 'core::v1::Pod' } }, representation: 'x' } } as unknown as HostGetRequest;
let records: Parameters<FrontendSpanRecorder>[];

beforeEach(() => {
  records = [];
  setFrontendSpanRecorder((...args) => records.push(args));
});
afterEach(() => { setFrontendSpanRecorder(null); vi.clearAllMocks(); });

describe('resource client spans', () => {
  it('records a classified failure without the error text and keeps cancel', async () => {
    const promise = Object.assign(Promise.reject({ code: 'FORBIDDEN', title: 'Denied', message: 'token=abc123' }), { cancel: vi.fn() });
    mocks.call.mockReturnValue(promise);
    const result = Get('kubernetes', request);
    expect(result).toBe(promise);
    expect(result.cancel).toBeTypeOf('function');
    await expect(result).rejects.toBeDefined();
    expect(records).toHaveLength(1);
    expect(records[0][0]).toBe('frontend.resource.call');
    expect(records[0][1]).toMatchObject({ operation: 'get', plugin_id: 'kubernetes', resource_type: 'core::v1::Pod', outcome: 'failure', error_class: 'FORBIDDEN' });
    expect(JSON.stringify(records)).not.toContain('abc123');
  });

  it('records a cancelled call as canceled', async () => {
    mocks.call.mockReturnValue(Object.assign(Promise.reject({ type: 'CANCELLED', code: 'CANCELLED', title: 'Cancelled', message: 'x' }), { cancel: vi.fn() }));
    await expect(Get('kubernetes', request)).rejects.toBeDefined();
    expect(records[0][1]).toMatchObject({ operation: 'get', outcome: 'canceled' });
    expect(records[0][4]).toBe(false);
  });

  it('records success', async () => {
    mocks.call.mockReturnValue(Object.assign(Promise.resolve({}), { cancel: vi.fn() }));
    await Get('kubernetes', request);
    expect(records[0][1]).toMatchObject({ operation: 'get', outcome: 'success' });
  });
});
