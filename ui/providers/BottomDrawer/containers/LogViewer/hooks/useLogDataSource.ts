import { useCallback, useEffect, useRef } from 'react';
import type { LogEntry, LogStreamEvent, LogDataSource } from '../types';

interface UseLogDataSourceOpts {
  source: LogDataSource;
  onLines: (entries: LogEntry[]) => void;
  onEvent: (event: LogStreamEvent) => void;
  paused?: boolean;
}

/**
 * Generic data source hook that replaces useLogStream when a LogDataSource
 * is provided. Handles connect/disconnect lifecycle and pause buffering.
 */
export function useLogDataSource({ source, onLines, onEvent, paused }: UseLogDataSourceOpts): void {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pauseBufferRef = useRef<LogEntry[]>([]);

  const flushPauseBuffer = useCallback(() => {
    if (pauseBufferRef.current.length > 0) {
      onLines(pauseBufferRef.current);
      pauseBufferRef.current = [];
    }
  }, [onLines]);

  // Flush pause buffer when unpaused
  useEffect(() => {
    if (!paused) {
      flushPauseBuffer();
    }
  }, [paused, flushPauseBuffer]);

  useEffect(() => {
    // Load historical entries
    if (source.loadHistory) {
      source.loadHistory().then((entries) => {
        if (entries.length > 0) onLines(entries);
      }).catch(() => {/* swallow */});
    }

    // Connect to real-time stream
    const cleanup = source.connect({
      onLines: (entries) => {
        if (pausedRef.current) {
          pauseBufferRef.current.push(...entries);
        } else {
          onLines(entries);
        }
      },
      onEvent,
    });

    return cleanup;
  // source identity must be stable (useMemo in consumer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
}
