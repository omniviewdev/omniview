import type { LogSink } from './logger';

const noopSink: LogSink = {
  write: () => {
    // Discard everything.
  },
};

let defaultSink: LogSink | null = null;

export function setDefaultSink(sink: LogSink): void {
  defaultSink = sink;
}

export function getDefaultSink(): LogSink {
  return defaultSink ?? noopSink;
}
