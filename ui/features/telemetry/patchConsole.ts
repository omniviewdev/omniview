import { trace } from '@opentelemetry/api';
import { createLogger, type LogSink } from './logger';
import { emptyContext, type TelemetryContext } from './context';

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

export function patchConsole(sink: LogSink): void {
  const logger = createLogger('console', sink);
  const getCtx = (): TelemetryContext => {
    const span = trace.getActiveSpan();
    if (!span) return emptyContext();
    const sc = span.spanContext();
    return { traceId: sc.traceId, spanId: sc.spanId };
  };
  console.log = (...args: unknown[]) => { originalConsole.log(...args); logger.debug(getCtx(), args.map(String).join(' ')); };
  console.info = (...args: unknown[]) => { originalConsole.info(...args); logger.info(getCtx(), args.map(String).join(' ')); };
  console.warn = (...args: unknown[]) => { originalConsole.warn(...args); logger.warn(getCtx(), args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { originalConsole.error(...args); logger.error(getCtx(), args.map(String).join(' ')); };
  console.debug = (...args: unknown[]) => { originalConsole.debug(...args); logger.trace(getCtx(), args.map(String).join(' ')); };
}
