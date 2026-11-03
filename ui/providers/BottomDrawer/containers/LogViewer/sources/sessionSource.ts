import { LogsClient } from '@omniviewdev/runtime/api';
import type { LogDataSource, LogStreamEvent, RawLogLine } from '../types';
import { parseRawLogLine } from '../utils/parseLogLine';

// Wails versions deliver either a scalar payload or an array of emit arguments.
function decodePayload(data: unknown): unknown {
  const payload = Array.isArray(data) && data.length === 1 && typeof data[0] === 'string' ? data[0] : data;
  return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

/** Wrap an SDK session, adopting output captured by the runtime during creation. */
export function createSessionSource(sessionId: string): LogDataSource {
  let lineCounter = 0;
  return {
    connect(handlers) {
      return LogsClient.SubscribeSessionEvents(sessionId, {
        onLines(data) {
          try {
            const rawLines = decodePayload(data) as RawLogLine[];
            handlers.onLines(rawLines.map(raw => parseRawLogLine(raw, ++lineCounter)));
          } catch (error) {
            console.error('Failed to parse log lines:', error);
          }
        },
        onEvent(data) {
          try {
            handlers.onEvent(decodePayload(data) as LogStreamEvent);
          } catch (error) {
            console.error('Failed to parse log event:', error);
          }
        },
      });
    },
  };
}
