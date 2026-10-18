import { DiagnosticsClient } from '@omniviewdev/runtime/api';
import type { LogSink } from './logger';
import { originalConsoleError } from './transport';

// Bridge frontend telemetry to the existing DiagnosticsClient.Log Wails binding.
export const bridgeSink: LogSink = {
  write(level, msg, fields) {
    DiagnosticsClient.Log(level, msg, fields).catch((err) => {
      if (import.meta.env?.DEV) {
        originalConsoleError('[bridgeSink] DiagnosticsClient.Log failed:', err);
      }
    });
  },
};
