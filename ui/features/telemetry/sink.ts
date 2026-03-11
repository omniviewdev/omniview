import type { LogSink } from './logger';

let defaultSink: LogSink | null = null;

export function setDefaultSink(sink: LogSink): void {
  defaultSink = sink;
}

export function getDefaultSink(): LogSink {
  if (!defaultSink) {
    throw new Error('Telemetry not initialized. Call initTelemetry() first.');
  }
  return defaultSink;
}
