import { useCallback, useRef, useState } from 'react';
import type { LogEntry } from '../types';

const DEFAULT_MAX_LINES = 100_000;

interface UseLogBufferOpts {
  maxLines?: number;
}

interface UseLogBufferResult {
  entries: LogEntry[];
  version: number;
  append: (newEntries: LogEntry[]) => void;
  clear: () => void;
  getEntries: () => LogEntry[];
  lineCount: number;
}

export function useLogBuffer(opts: UseLogBufferOpts = {}): UseLogBufferResult {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const bufferRef = useRef<LogEntry[]>([]);
  const [version, setVersion] = useState(0);
  const rafRef = useRef<number | null>(null);

  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setVersion((v) => v + 1);
    });
  }, []);

  const append = useCallback(
    (newEntries: LogEntry[]) => {
      const buffer = bufferRef.current;
      buffer.push(...newEntries);

      // Evict from head if over limit
      if (buffer.length > maxLines) {
        const excess = buffer.length - maxLines;
        buffer.splice(0, excess);
      }

      scheduleRender();
    },
    [maxLines, scheduleRender],
  );

  const clear = useCallback(() => {
    bufferRef.current = [];
    setVersion((v) => v + 1);
  }, []);

  const getEntries = useCallback(() => bufferRef.current, []);

  return {
    entries: bufferRef.current,
    version,
    append,
    clear,
    getEntries,
    lineCount: bufferRef.current.length,
  };
}
