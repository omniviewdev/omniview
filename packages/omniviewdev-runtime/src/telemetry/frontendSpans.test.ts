import { afterEach, describe, expect, it } from 'vitest';
import { observeFrontendOperation, setFrontendSpanRecorder, type FrontendSpanRecorder } from './frontendSpans';

describe('frontend operation recorder', () => {
  afterEach(() => setFrontendSpanRecorder(null));
  it('retains the original promise and classifies a rejected operation without the error text', async () => {
    const records: Parameters<FrontendSpanRecorder>[] = [];
    setFrontendSpanRecorder((...args) => records.push(args));
    const promise = Object.assign(Promise.reject({ code: 'FORBIDDEN', title: 'Denied', message: 'token=abc123' }), { cancel: () => {} });
    const result = observeFrontendOperation('frontend.resource.call', { operation: 'get' }, promise);
    expect(result).toBe(promise);
    expect(result.cancel).toBeTypeOf('function');
    await expect(result).rejects.toBeDefined();
    expect(records[0][1]).toMatchObject({ operation: 'get', outcome: 'failure', error_class: 'FORBIDDEN' });
    expect(JSON.stringify(records)).not.toContain('abc123');
  });
});
