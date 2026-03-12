import { describe, it, expect, vi } from 'vitest';

const { mockSpan, mockTracer, mockContextWith } = vi.hoisted(() => {
  const mockSpan = {
    spanContext: () => ({ traceId: 'abc123', spanId: 'def456' }),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };
  const mockTracer = {
    startSpan: vi.fn(() => mockSpan),
  };
  const mockContextWith = vi.fn((_ctx: unknown, fn: () => unknown) => fn());
  return { mockSpan, mockTracer, mockContextWith };
});

vi.mock('@opentelemetry/api', () => {
  return {
    trace: {
      getTracer: () => mockTracer,
      setSpan: (_ctx: unknown, span: unknown) => ({ _span: span }),
    },
    context: {
      active: () => ({}),
      with: mockContextWith,
    },
    propagation: {
      inject: (_ctx: unknown, carrier: Record<string, string>) => {
        carrier['traceparent'] = '00-abc123-def456-01';
      },
    },
    SpanStatusCode: { OK: 0, ERROR: 1 },
  };
});

import { instrumentBinding } from './instrumentation';

describe('instrumentBinding', () => {
  it('prepends carrier to binding arguments and completes span lifecycle', async () => {
    mockSpan.setStatus.mockClear();
    mockSpan.end.mockClear();
    mockContextWith.mockClear();
    const mockBinding = vi.fn().mockResolvedValue('result');
    const instrumented = instrumentBinding('TestBinding', mockBinding);
    const result = await instrumented('arg1', 'arg2');
    expect(result).toBe('result');
    const [carrier, ...rest] = mockBinding.mock.calls[0];
    expect(carrier).toHaveProperty('traceparent');
    expect(rest).toEqual(['arg1', 'arg2']);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 0 }); // SpanStatusCode.OK
    expect(mockSpan.end).toHaveBeenCalledOnce();
    expect(mockContextWith).toHaveBeenCalledOnce();
    expect(typeof mockContextWith.mock.calls[0][1]).toBe('function');
  });

  it('records exception on binding error', async () => {
    mockSpan.recordException.mockClear();
    mockSpan.setStatus.mockClear();
    mockContextWith.mockClear();
    const error = new Error('binding failed');
    const mockBinding = vi.fn().mockRejectedValue(error);
    const instrumented = instrumentBinding('TestBinding', mockBinding);
    await expect(instrumented()).rejects.toThrow('binding failed');
    expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(mockContextWith).toHaveBeenCalledOnce();
  });
});
