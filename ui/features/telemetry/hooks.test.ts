import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: () => ({
      spanContext: () => ({ traceId: 'trace-abc', spanId: 'span-def' }),
    }),
  },
}));

const mockSink = { write: vi.fn() };
vi.mock('./logger', () => ({
  createLogger: (name: string, sink: any) => ({
    trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    named: vi.fn(), with: vi.fn(), _name: name,
  }),
}));

vi.mock('./sink', () => ({
  getDefaultSink: () => mockSink,
}));

import { useLogger, useTelemetryContext } from './hooks';

describe('useLogger', () => {
  it('returns a logger named after the component', () => {
    const { result } = renderHook(() => useLogger('MyComponent'));
    expect(result.current).toBeDefined();
    expect((result.current as any)._name).toBe('MyComponent');
  });

  it('is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useLogger('MyComponent'));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('useTelemetryContext', () => {
  it('lazily resolves traceId from active span', () => {
    const { result } = renderHook(() => useTelemetryContext({ component: 'Test' }));
    expect(result.current.traceId).toBe('trace-abc');
    expect(result.current.spanId).toBe('span-def');
    expect(result.current.component).toBe('Test');
  });
});
