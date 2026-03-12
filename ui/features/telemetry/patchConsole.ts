import { trace } from '@opentelemetry/api';
import { createLogger, type LogSink } from './logger';
import { emptyContext, type TelemetryContext } from './context';

let originalConsole: {
  log: typeof console.log;
  info: typeof console.info;
  warn: typeof console.warn;
  error: typeof console.error;
  debug: typeof console.debug;
} | null = null;

let patched = false;

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function patchConsole(sink: LogSink): void {
  if (patched) return;

  originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  patched = true;

  const logger = createLogger('console', sink);
  const getCtx = (): TelemetryContext => {
    const span = trace.getActiveSpan();
    if (!span) return emptyContext();
    const sc = span.spanContext();
    return { traceId: sc.traceId, spanId: sc.spanId };
  };
  const fmt = (...args: unknown[]) => args.map(serializeArg).join(' ');

  console.log = (...args: unknown[]) => { originalConsole!.log(...args); logger.debug(getCtx(), fmt(...args)); };
  console.info = (...args: unknown[]) => { originalConsole!.info(...args); logger.info(getCtx(), fmt(...args)); };
  console.warn = (...args: unknown[]) => { originalConsole!.warn(...args); logger.warn(getCtx(), fmt(...args)); };
  console.error = (...args: unknown[]) => { originalConsole!.error(...args); logger.error(getCtx(), fmt(...args)); };
  console.debug = (...args: unknown[]) => { originalConsole!.debug(...args); logger.trace(getCtx(), fmt(...args)); };
}
