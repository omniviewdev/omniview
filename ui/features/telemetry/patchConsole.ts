import { trace } from '@opentelemetry/api';
import { createLogger, type LogSink } from './logger';
import { emptyContext, type TelemetryContext } from './context';

let patched = false;

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function patchConsole(sink: LogSink): void {
  if (patched) return;

  const saved = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  const logger = createLogger('console', sink);
  const getCtx = (): TelemetryContext => {
    const span = trace.getActiveSpan();
    if (!span) return emptyContext();
    const sc = span.spanContext();
    return { traceId: sc.traceId, spanId: sc.spanId };
  };
  const fmt = (...args: unknown[]) => args.map(serializeArg).join(' ');

  console.log = (...args: unknown[]) => { saved.log(...args); try { logger.debug(getCtx(), fmt(...args)); } catch { /* fail-open */ } };
  console.info = (...args: unknown[]) => { saved.info(...args); try { logger.info(getCtx(), fmt(...args)); } catch { /* fail-open */ } };
  console.warn = (...args: unknown[]) => { saved.warn(...args); try { logger.warn(getCtx(), fmt(...args)); } catch { /* fail-open */ } };
  console.error = (...args: unknown[]) => { saved.error(...args); try { logger.error(getCtx(), fmt(...args)); } catch { /* fail-open */ } };
  console.debug = (...args: unknown[]) => { saved.debug(...args); try { logger.trace(getCtx(), fmt(...args)); } catch { /* fail-open */ } };

  patched = true;
}
