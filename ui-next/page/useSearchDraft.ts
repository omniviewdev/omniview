import { useEffect, useRef, useState } from 'react';

/** How long a typed text waits before the list applies it (slice 1a plan 1.2: search over the acquired rows, 500 ms debounce). */
export const SEARCH_DELAY_MS = 500;

export type SearchDraft = {
  /** What the field shows: the text as it is typed. */
  readonly draft: string;
  /** What the list applies: the draft, `SEARCH_DELAY_MS` after the last key. */
  readonly query: string;
  /** A change of the field. A cleared field is applied at once: an empty search is no search and needs no delay. */
  change(value: string): void;
  /** Applies the draft now: the person pressed Enter and the work they were waiting for starts. */
  flush(): void;
  /** Drops the draft, the query and any text still waiting (Clear filters). */
  clear(): void;
};

/**
 * The draft of a search and the query the list applies. The field is controlled by the draft, so typing never waits; the list follows the
 * query, so a key that is followed by another does no work. One timer, owned here, goes with the page.
 */
export function useSearchDraft(delay: number = SEARCH_DELAY_MS): SearchDraft {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The last text typed, read by `flush`: Enter may arrive before the render that holds the last key.
  const latest = useRef('');

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const change = (value: string) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    latest.current = value;
    setDraft(value);
    if (value === '') {
      setQuery('');
      return;
    }

    timer.current = setTimeout(() => {
      timer.current = undefined;
      setQuery(value);
    }, delay);
  };

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setQuery(latest.current);
  };

  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    latest.current = '';
    setDraft('');
    setQuery('');
  };

  return { draft, query, change, flush, clear };
}
