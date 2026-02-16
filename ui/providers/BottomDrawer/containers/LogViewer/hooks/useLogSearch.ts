import { useCallback, useMemo, useState } from 'react';
import type { LogEntry, SearchMatch } from '../types';

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
}

export function useLogSearch({ entries, version }: UseLogSearchOpts): UseLogSearchResult {
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const matches = useMemo(() => {
    if (!query) return [];

    const result: SearchMatch[] = [];
    let pattern: RegExp;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      pattern = isRegex ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
    } catch {
      return [];
    }

    for (let i = 0; i < entries.length; i++) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(entries[i].content)) !== null) {
        result.push({
          lineIndex: i,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
        });
      }
    }

    return result;
  }, [query, isRegex, caseSensitive, entries, version]);

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
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
