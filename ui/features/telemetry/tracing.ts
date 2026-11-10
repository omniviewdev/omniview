import { SimpleSpanProcessor, TracerProvider, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace, propagation, SpanStatusCode } from '@opentelemetry/api';
import { ExportResultCode, W3CTraceContextPropagator, type ExportResult } from '@opentelemetry/core';
import { TelemetryClient } from '@omniviewdev/runtime/api';

let provider: TracerProvider | null = null;

// Never forward span attributes, exception text, baggage, or arbitrary names.
export class WailsSpanExporter implements SpanExporter {
  private readonly pending = new Set<Promise<void>>();

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    const safe = spans.filter((span) => span.name === 'frontend.startup' || span.name === 'frontend.interaction').slice(0, 32).map((span) => ({
      name: span.name,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: span.parentSpanContext?.spanId,
      start: span.startTime,
      end: span.endTime,
      error: span.status.code === SpanStatusCode.ERROR,
    }));
    if (!safe.length) {
      done({ code: ExportResultCode.SUCCESS });
      return;
    }

    if (this.pending.size >= 16) {
      done({ code: ExportResultCode.FAILED });
      return;
    }

    const request = TelemetryClient.IngestFrontendSignals(JSON.stringify({ spans: safe })).then(
      () => {
        done({ code: ExportResultCode.SUCCESS });
      },
      () => {
        done({ code: ExportResultCode.FAILED });
      },
    ).finally(() => {
      this.pending.delete(request);
    });
    this.pending.add(request);
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.pending);
  }
}

export function initTracing(appVersion: string): TracerProvider {
  if (provider) {
    return provider;
  }

  provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'omniview-frontend', 'service.version': appVersion }),
    spanProcessors: [new SimpleSpanProcessor({ exporter: new WailsSpanExporter() })],
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
    trace.disable();
    propagation.disable();
    provider = null;
  }
}
