import { TracerProvider } from '@opentelemetry/sdk-trace';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace, propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

let provider: TracerProvider | null = null;

export function initTracing(appVersion: string): TracerProvider {
  if (provider) {
    return provider;
  }

  provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'omniview-frontend',
      'service.version': appVersion,
    }),
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  return provider;
}

export function getTracerProvider(): TracerProvider | null {
  return provider;
}

export async function shutdownTracing(): Promise<void> {
  if (!provider) {
    return;
  }

  try {
    await provider.shutdown();
  } finally {
    provider = null;
  }
}
