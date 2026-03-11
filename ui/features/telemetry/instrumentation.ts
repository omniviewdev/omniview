import { trace, context, propagation, SpanStatusCode } from '@opentelemetry/api';

type WailsBinding = (...args: any[]) => Promise<any>;
const TRACER_NAME = 'omniview.wails';

export function instrumentBinding(name: string, fn: WailsBinding): WailsBinding {
  return async (...args: any[]) => {
    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(`wails.${name}`);
    const carrier: Record<string, string> = {};
    propagation.inject(trace.setSpan(context.active(), span), carrier);
    try {
      const result = await fn(carrier, ...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  };
}
