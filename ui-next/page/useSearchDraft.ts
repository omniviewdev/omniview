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

export type SearchDraftOptions = {
  /** The search the field opens with, applied at once: the one the page was left with (H7), which was applied when it was left. */
  readonly initial?: string | undefined;
  /** Told the search each time the one the list applies changes, from the timer, Enter and a cleared field; never for the initial one, and never for a text that is typed and not yet applied. */
  readonly onApply?: ((query: string) => void) | undefined;
};

/**
 * The draft of a search and the query the list applies. The field is controlled by the draft, so typing never waits; the list follows the
 * query, so a key that is followed by another does no work. One timer, owned here, goes with the page.
 */
export function useSearchDraft(delay: number = SEARCH_DELAY_MS, options: SearchDraftOptions = {}): SearchDraft {
  const [draft, setDraft] = useState(options.initial ?? '');
  const [query, setQuery] = useState(options.initial ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The last text typed, read by `flush`: Enter may arrive before the render that holds the last key.
  const latest = useRef(options.initial ?? '');
  // The text the list applies now, so that what is told is a change; and who is told, as of the last render (a timer outlives the render that made it).
  const applied = useRef(options.initial ?? '');
  const told = useRef(options.onApply);

  useEffect(() => {
    told.current = options.onApply;
  });

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const apply = (value: string) => {
    setQuery(value);
    if (value !== applied.current) {
      applied.current = value;
      told.current?.(value);
    }
  };

  const change = (value: string) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    latest.current = value;
    setDraft(value);
    if (value === '') {
      apply('');
      return;
    }

    timer.current = setTimeout(() => {
      timer.current = undefined;
      apply(value);
    }, delay);
  };

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    apply(latest.current);
  };

  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    latest.current = '';
    setDraft('');
    apply('');
  };

  return { draft, query, change, flush, clear };
}
