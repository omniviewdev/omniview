import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace, propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

let provider: BasicTracerProvider | null = null;

export function initTracing(appVersion: string): BasicTracerProvider {
  if (provider) return provider;
  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'omniview-frontend',
      'service.version': appVersion,
    }),
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  return provider;
}

export function getTracerProvider(): BasicTracerProvider | null { return provider; }

export async function shutdownTracing(): Promise<void> {
  if (!provider) return;
  try {
    await provider.shutdown();
  } finally {
    provider = null;
  }
}
