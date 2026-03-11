import { useMemo } from 'react';
import { trace } from '@opentelemetry/api';
import type { TelemetryContext } from './context';
import { createLogger, type Logger } from './logger';
import { getDefaultSink } from './sink';

export function useLogger(component: string): Logger {
  return useMemo(() => createLogger(component, getDefaultSink()), [component]);
}

export function useTelemetryContext(overrides?: Partial<TelemetryContext>): TelemetryContext {
  return useMemo(() => new Proxy(
    { ...overrides } as TelemetryContext,
    {
      get(target, prop) {
        if (prop === 'traceId') {
          return trace.getActiveSpan()?.spanContext().traceId;
        }
        if (prop === 'spanId') {
          return trace.getActiveSpan()?.spanContext().spanId;
        }
        return target[prop as keyof TelemetryContext];
      },
    },
  ), [overrides]);
}
