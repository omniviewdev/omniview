import { trace, context, propagation, SpanStatusCode } from '@opentelemetry/api';

export type WailsBinding = (...args: any[]) => Promise<any>;
const TRACER_NAME = 'omniview.wails';

export function instrumentBinding(name: string, fn: WailsBinding): WailsBinding {
  return async (...args: any[]) => {
    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(`wails.${name}`);
    const spanCtx = trace.setSpan(context.active(), span);
    const carrier: Record<string, string> = {};
    propagation.inject(spanCtx, carrier);
    try {
      const result = await context.with(spanCtx, () => fn(carrier, ...args));
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
