import { isCancelledError, parseAppError } from '../errors/parseAppError';
import { frontendSpanSchema, sanitizeFrontendAttributes, type FrontendSpanAttributes, type FrontendSpanName } from './frontendSpanSchema';

export type FrontendSpanRecorder = (name: FrontendSpanName, attrs: FrontendSpanAttributes, startMs: number, endMs: number, failed: boolean) => void;
export type ErrorClass = (typeof frontendSpanSchema)['frontend.resource.call']['error_class']['values'][number];
let recorder: FrontendSpanRecorder | null = null;

export function setFrontendSpanRecorder(value: FrontendSpanRecorder | null): void { recorder = value; }

export function recordFrontendSpan(name: FrontendSpanName, attrs: FrontendSpanAttributes, startMs: number, endMs: number, failed: boolean): void {
  try { recorder?.(name, sanitizeFrontendAttributes(name, attrs), startMs, endMs, failed); } catch { /* Telemetry must not alter the operation. */ }
}

export function classifyFrontendError(error: unknown): ErrorClass {
  if (isCancelledError(error)) return 'canceled';
  const code = parseAppError(error).code;
  const allowed: readonly string[] = frontendSpanSchema['frontend.resource.call'].error_class.values;
  return code && allowed.includes(code) ? code as ErrorClass : 'other';
}

export function observeFrontendOperation<P extends PromiseLike<unknown>>(name: FrontendSpanName, attrs: FrontendSpanAttributes, promise: P): P {
  const start = Date.now();
  promise.then(
    () => { recordFrontendSpan(name, { ...attrs, outcome: 'success' }, start, Date.now(), false); },
    (error: unknown) => {
      let errorClass: ErrorClass = 'other';
      try { errorClass = classifyFrontendError(error); } catch { /* Classification must not alter the operation. */ }
      recordFrontendSpan(name, { ...attrs, outcome: errorClass === 'canceled' ? 'canceled' : 'failure', error_class: errorClass }, start, Date.now(), errorClass !== 'canceled');
    },
  );
  return promise;
}
