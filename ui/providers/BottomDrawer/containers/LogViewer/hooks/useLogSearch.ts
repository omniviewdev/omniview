import { useCallback, useMemo, useState } from 'react';
import type { LogEntry, SearchMatch } from '../types';
import { compileSearchPattern, execSafeSearch } from '../utils/regexSafety';

interface UseLogSearchOpts {
  entries: LogEntry[];
  version: number;
}

interface UseLogSearchResult {
  query: string;
  setQuery: (q: string) => void;
  isRegex: boolean;
  setIsRegex: (v: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
  matches: SearchMatch[];
  currentMatchIndex: number;
  nextMatch: () => void;
  prevMatch: () => void;
  totalMatches: number;
  /** True when results were truncated (match cap or time budget hit). */
  capped: boolean;
}

export function useLogSearch({ entries, version }: UseLogSearchOpts): UseLogSearchResult {
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const searchResult = useMemo(() => {
    const empty = { matches: [] as SearchMatch[], capped: false };

    const pattern = compileSearchPattern(query, { isRegex, caseSensitive });
    if (!pattern) return empty;

    const { results, capped } = execSafeSearch(
      pattern,
      entries.length,
      (i) => entries[i].content,
      (lineIndex, start, end) => ({
        lineIndex,
        startOffset: start,
        endOffset: end,
      }),
    );

    return { matches: results, capped };
  }, [query, isRegex, caseSensitive, entries, version]);

  const { matches, capped } = searchResult;

  const nextMatch = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatchIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const prevMatch = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatchIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  return {
    query,
    setQuery,
    isRegex,
    setIsRegex,
    caseSensitive,
    setCaseSensitive,
    matches,
    currentMatchIndex,
    nextMatch,
    prevMatch,
    totalMatches: matches.length,
    capped,
  };
}
