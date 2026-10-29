import { useCallback, useRef, useState } from 'react';
import type { LogEntry } from '../types';

const DEFAULT_MAX_LINES = 100_000;

type UseLogBufferOpts = {
  maxLines?: number;
};

type UseLogBufferResult = {
  entries: LogEntry[];
  version: number;
  append: (newEntries: LogEntry[]) => void;
  clear: () => void;
  getEntries: () => LogEntry[];
  lineCount: number;
  /** Incremented on head eviction or clear; signals search indices are invalid. */
  evictionCount: number;
};

export function useLogBuffer(opts: UseLogBufferOpts = {}): UseLogBufferResult {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const [snapshot, setSnapshot] = useState({ entries: [] as LogEntry[], version: 0, evictionCount: 0 });
  const bufferRef = useRef<LogEntry[]>(snapshot.entries);
  const rafRef = useRef<number | null>(null);
  const evictionCountRef = useRef(0);

  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const entries = bufferRef.current;
      const evictionCount = evictionCountRef.current;
      setSnapshot((previous) => ({
        entries,
        version: previous.version + 1,
        evictionCount,
      }));
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
        evictionCountRef.current++;
      }

      scheduleRender();
    },
    [maxLines, scheduleRender],
  );

  const clear = useCallback(() => {
    bufferRef.current = [];
    evictionCountRef.current++;
    const entries = bufferRef.current;
    const evictionCount = evictionCountRef.current;
    setSnapshot((previous) => ({
      entries,
      version: previous.version + 1,
      evictionCount,
    }));
  }, []);

  const getEntries = useCallback(() => bufferRef.current, []);

  return {
    entries: snapshot.entries,
    version: snapshot.version,
    append,
    clear,
    getEntries,
    lineCount: snapshot.entries.length,
    evictionCount: snapshot.evictionCount,
  };
}
