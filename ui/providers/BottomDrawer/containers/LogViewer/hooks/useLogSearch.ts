import { useCallback, useState } from 'react';
import type { LogEntry, SearchMatch } from '../types';
import { compileSearchPattern, execSafeSearchRange, MAX_MATCH_COUNT } from '../utils/regexSafety';

type UseLogSearchOpts = {
  entries: LogEntry[];
  version: number;
  evictionCount: number;
};

type UseLogSearchResult = {
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
};

type SearchResult = {
  matches: SearchMatch[];
  capped: boolean;
};

const EMPTY_RESULT: SearchResult = { matches: [], capped: false };

export function useLogSearch({ entries, version, evictionCount }: UseLogSearchOpts): UseLogSearchResult {
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [searchResult, setSearchResult] = useState<SearchResult>(EMPTY_RESULT);

  const [previous, setPrevious] = useState({
    query: '', isRegex: false, caseSensitive: false, evictionCount: 0,
    entries, version, searchedLength: 0, capped: false, matches: [] as SearchMatch[],
  });

  if (previous.query !== query || previous.isRegex !== isRegex || previous.caseSensitive !== caseSensitive
    || previous.evictionCount !== evictionCount || previous.entries !== entries || previous.version !== version) {
    const pattern = compileSearchPattern(query, { isRegex, caseSensitive });
    if (!pattern) {
      // Reset everything
      setPrevious({ query, isRegex, caseSensitive, evictionCount, entries, version,
        searchedLength: 0, capped: false, matches: [] });
      setSearchResult(EMPTY_RESULT);
    } else {

      const searchParamsChanged =
        query !== previous.query ||
      isRegex !== previous.isRegex ||
      caseSensitive !== previous.caseSensitive;
      const evicted = evictionCount !== previous.evictionCount;
      const entriesRefChanged = entries !== previous.entries;
      const entriesShrunk = entries.length < previous.searchedLength;

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
      } else if (previous.capped) {
      // Already capped — skip searching new entries
        result = { matches: previous.matches, capped: true };
      } else if (entries.length > previous.searchedLength) {
      // Incremental: search only new entries [prevLength, currentLength)
        const budget = MAX_MATCH_COUNT - previous.matches.length;

        const onMatch = (lineIndex: number, start: number, end: number): SearchMatch => ({
          lineIndex,
          startOffset: start,
          endOffset: end,
        });

        const { results: newMatches, capped } = execSafeSearchRange(
          pattern,
          previous.searchedLength,
          entries.length,
          (i) => entries[i].content,
          onMatch,
          budget,
        );

        if (newMatches.length > 0) {
          const combined = [...previous.matches, ...newMatches];
          result = { matches: combined, capped };
        } else {
          result = { matches: previous.matches, capped };
        }
      } else {
      // No change needed
        result = { matches: previous.matches, capped: previous.capped };
      }

      setPrevious({ query, isRegex, caseSensitive, evictionCount, entries, version,
        searchedLength: entries.length, capped: result.capped, matches: result.matches });
      setSearchResult(result);
    }
  }

  const { matches, capped } = searchResult;

  const nextMatch = useCallback(() => {
    if (matches.length === 0) {
      return;
    }

    setCurrentMatchIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const prevMatch = useCallback(() => {
    if (matches.length === 0) {
      return;
    }

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
