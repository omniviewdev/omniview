import type { LogSink } from './logger';
import { patchConsole } from './patchConsole';
import { setDefaultSink } from './sink';

export type { LogSink };

export function initTelemetry(sink: LogSink): void {
  setDefaultSink(sink);
  patchConsole(sink);
}
