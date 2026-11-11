import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';

const ingest = vi.hoisted(() => vi.fn(async (_payload: string) => Promise.resolve()));
vi.mock('@omniviewdev/runtime/api', () => ({ TelemetryClient: { IngestFrontendSignals: ingest } }));

import { initTracing, shutdownTracing } from './tracing';

describe('frontend trace bridge', () => {
  beforeEach(async () => {
    await shutdownTracing();
    ingest.mockClear();
  });

  it('exports real span identity and timing without sensitive attributes or errors', async () => {
    const provider = initTracing('test');
    const span = provider.getTracer('test').startSpan('frontend.interaction');
    const identity = span.spanContext();
    span.setAttribute('secret', 'private value');
    span.recordException(new Error('private exception'));
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'private status' });
    span.end();
    await provider.forceFlush();
    expect(ingest).toHaveBeenCalledOnce();
    const payload = JSON.parse(ingest.mock.calls[0][0]);
    expect(payload.spans[0]).toMatchObject({ name: 'frontend.interaction', traceId: identity.traceId, spanId: identity.spanId, error: true });
    expect(payload.spans[0].start[0]).toBeGreaterThan(0);
    expect(payload.spans[0].end[0]).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toContain('private');
  });

  it('forwards only valid schema attributes', async () => {
    const provider = initTracing('test');
    const span = provider.getTracer('test').startSpan('frontend.resource.call');
    span.setAttribute('operation', 'get');
    span.setAttribute('plugin_id', 'Invalid/Plugin');
    span.setAttribute('secret', 'token=abc123');
    span.end();
    await provider.forceFlush();
    const payload = JSON.parse(ingest.mock.calls[0][0]);
    expect(payload.spans[0].attributes).toEqual({ operation: 'get' });
    expect(JSON.stringify(payload)).not.toContain('abc123');
  });

  it('does not forward arbitrary span names', async () => {
    const provider = initTracing('test');
    provider.getTracer('test').startSpan('secret-name').end();
    await provider.forceFlush();
    expect(ingest).not.toHaveBeenCalled();
  });
});
