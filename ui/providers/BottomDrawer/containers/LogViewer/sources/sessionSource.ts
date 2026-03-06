import { EventsOn, EventsOff } from '@omniviewdev/runtime/runtime';
import type { LogDataSource, LogStreamEvent, RawLogLine } from '../types';
import { parseRawLogLine } from '../utils/parseLogLine';

/**
 * Creates a LogDataSource that wraps the existing SDK log session stream.
 * This is functionally equivalent to what useLogStream did, but packaged
 * as a data source for the unified LogViewerContainer.
 */
export function createSessionSource(sessionId: string): LogDataSource {
  let lineCounter = 0;

  return {
    connect(handlers) {
      const linesKey = `core/logs/lines/${sessionId}`;
      const eventKey = `core/logs/event/${sessionId}`;

      const linesCleanup = EventsOn(linesKey, (data: string) => {
        try {
          const rawLines: RawLogLine[] = JSON.parse(data);
          const entries = rawLines.map(raw => parseRawLogLine(raw, ++lineCounter));
          handlers.onLines(entries);
        } catch (e) {
          console.error('Failed to parse log lines:', e);
        }
      });

      const eventCleanup = EventsOn(eventKey, (data: string) => {
        try {
          const event: LogStreamEvent = JSON.parse(data);
          handlers.onEvent(event);
        } catch (e) {
          console.error('Failed to parse log event:', e);
        }
      });

      return () => {
        linesCleanup();
        eventCleanup();
        EventsOff(linesKey);
        EventsOff(eventKey);
      };
    },
    // No loadHistory — SDK sessions stream from the beginning.
    // No declaredDimensions — useLogSources fetches from LogsClient.GetSession.
  };
}
