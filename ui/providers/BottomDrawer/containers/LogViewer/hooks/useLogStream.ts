import { useCallback, useEffect, useRef } from 'react';
import { EventsOn, EventsOff } from '@omniviewdev/runtime/runtime';
import type { LogEntry, LogStreamEvent, RawLogLine } from '../types';
import { parseRawLogLine } from '../utils/parseLogLine';

interface UseLogStreamOpts {
  sessionId: string;
  onLines: (entries: LogEntry[]) => void;
  onEvent: (event: LogStreamEvent) => void;
  paused?: boolean;
}

export function useLogStream({ sessionId, onLines, onEvent, paused }: UseLogStreamOpts): void {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const lineCounterRef = useRef(0);
  const pauseBufferRef = useRef<LogEntry[]>([]);

  const flushPauseBuffer = useCallback(() => {
    if (pauseBufferRef.current.length > 0) {
      onLines(pauseBufferRef.current);
      pauseBufferRef.current = [];
    }
  }, [onLines]);

  useEffect(() => {
    if (!sessionId) return;

    lineCounterRef.current = 0;

    const linesKey = `core/logs/lines/${sessionId}`;
    const eventKey = `core/logs/event/${sessionId}`;

    const linesCleanup = EventsOn(linesKey, (data: string) => {
      try {
        const rawLines: RawLogLine[] = JSON.parse(data);
        const entries = rawLines.map(raw => parseRawLogLine(raw, ++lineCounterRef.current));

        if (pausedRef.current) {
          pauseBufferRef.current.push(...entries);
        } else {
          onLines(entries);
        }
      } catch (e) {
        console.error('Failed to parse log lines:', e);
      }
    });

    const eventCleanup = EventsOn(eventKey, (data: string) => {
      try {
        const event: LogStreamEvent = JSON.parse(data);
        onEvent(event);
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
  }, [sessionId, onLines, onEvent]);

  // Flush pause buffer when unpaused
  useEffect(() => {
    if (!paused) {
      flushPauseBuffer();
    }
  }, [paused, flushPauseBuffer]);
}
