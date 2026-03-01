import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, SearchMatch } from '../types';
import { compileSearchPattern, execSafeSearchRange, MAX_MATCH_COUNT } from '../utils/regexSafety';

interface UseLogSearchOpts {
  entries: LogEntry[];
  version: number;
  evictionCount: number;
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

interface SearchResult {
  matches: SearchMatch[];
  capped: boolean;
}

const EMPTY_RESULT: SearchResult = { matches: [], capped: false };

export function useLogSearch({ entries, version, evictionCount }: UseLogSearchOpts): UseLogSearchResult {
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [searchResult, setSearchResult] = useState<SearchResult>(EMPTY_RESULT);

  // Refs for tracking previous state to decide full vs incremental search
  const prevQueryRef = useRef('');
  const prevIsRegexRef = useRef(false);
  const prevCaseSensitiveRef = useRef(false);
  const prevEvictionCountRef = useRef(0);
  const prevEntriesRef = useRef<LogEntry[]>(entries);
  const prevSearchedLengthRef = useRef(0);
  const prevCappedRef = useRef(false);
  const prevMatchesRef = useRef<SearchMatch[]>([]);

  useEffect(() => {
    const pattern = compileSearchPattern(query, { isRegex, caseSensitive });
    if (!pattern) {
      // Reset everything
      prevQueryRef.current = query;
      prevIsRegexRef.current = isRegex;
      prevCaseSensitiveRef.current = caseSensitive;
      prevEvictionCountRef.current = evictionCount;
      prevEntriesRef.current = entries;
      prevSearchedLengthRef.current = 0;
      prevCappedRef.current = false;
      prevMatchesRef.current = [];
      setSearchResult(EMPTY_RESULT);
      return;
    }

    const searchParamsChanged =
      query !== prevQueryRef.current ||
      isRegex !== prevIsRegexRef.current ||
      caseSensitive !== prevCaseSensitiveRef.current;
    const evicted = evictionCount !== prevEvictionCountRef.current;
    const entriesRefChanged = entries !== prevEntriesRef.current;
    const entriesShrunk = entries.length < prevSearchedLengthRef.current;

    const needsFullSearch =
      searchParamsChanged || evicted || entriesRefChanged || entriesShrunk;

    let result: SearchResult;

    if (needsFullSearch) {
      // Full re-search from scratch
      const onMatch = (lineIndex: number, start: number, end: number): SearchMatch => ({
        lineIndex,
        startOffset: start,
        endOffset: end,
      });

      const { results, capped } = execSafeSearchRange(
        pattern,
        0,
        entries.length,
        (i) => entries[i].content,
        onMatch,
      );

      result = { matches: results, capped };

      if (searchParamsChanged) {
        setCurrentMatchIndex(0);
      }
    } else if (prevCappedRef.current) {
      // Already capped — skip searching new entries
      result = { matches: prevMatchesRef.current, capped: true };
    } else if (entries.length > prevSearchedLengthRef.current) {
      // Incremental: search only new entries [prevLength, currentLength)
      const budget = MAX_MATCH_COUNT - prevMatchesRef.current.length;

      const onMatch = (lineIndex: number, start: number, end: number): SearchMatch => ({
        lineIndex,
        startOffset: start,
        endOffset: end,
      });

      const { results: newMatches, capped } = execSafeSearchRange(
        pattern,
        prevSearchedLengthRef.current,
        entries.length,
        (i) => entries[i].content,
        onMatch,
        budget,
      );

      if (newMatches.length > 0) {
        const combined = [...prevMatchesRef.current, ...newMatches];
        result = { matches: combined, capped };
      } else {
        result = { matches: prevMatchesRef.current, capped };
      }
    } else {
      // No change needed
      result = { matches: prevMatchesRef.current, capped: prevCappedRef.current };
    }

    // Update all tracking refs
    prevQueryRef.current = query;
    prevIsRegexRef.current = isRegex;
    prevCaseSensitiveRef.current = caseSensitive;
    prevEvictionCountRef.current = evictionCount;
    prevEntriesRef.current = entries;
    prevSearchedLengthRef.current = entries.length;
    prevCappedRef.current = result.capped;
    prevMatchesRef.current = result.matches;

    setSearchResult(result);
  }, [query, isRegex, caseSensitive, version, evictionCount, entries]);

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
