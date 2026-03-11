import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { trace, propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

let provider: BasicTracerProvider | null = null;

export function initTracing(appVersion: string): BasicTracerProvider {
  if (provider) return provider;
  provider = new BasicTracerProvider({
    resource: new Resource({
      'service.name': 'omniview-frontend',
      'service.version': appVersion,
    }),
  });
  trace.setTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  return provider;
}

export function getTracerProvider(): BasicTracerProvider | null { return provider; }

export function shutdownTracing(): Promise<void> {
  if (provider) return provider.shutdown();
  return Promise.resolve();
}
