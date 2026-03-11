import type { Logger } from './logger';
import { createLogger } from './logger';
import { patchConsole } from './patchConsole';
import { setDefaultSink, getDefaultSink } from './sink';

export type { TelemetryContext, Fields } from './context';
export type { Logger, LogSink } from './logger';
export { createLogger } from './logger';
export { createTelemetryContext, emptyContext } from './context';
export { WailsTransport } from './transport';
export { instrumentBinding } from './instrumentation';
export { useLogger, useTelemetryContext } from './hooks';
export { getDefaultSink } from './sink';

export function getLogger(name: string): Logger {
  return createLogger(name, getDefaultSink());
}

export function initTelemetry(sink: import('./logger').LogSink): void {
  setDefaultSink(sink);
  patchConsole(sink);
}
