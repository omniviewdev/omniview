import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DELAY_MS, useSearchDraft } from './useSearchDraft';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSearchDraft (the draft is the field\'s, the query is what the list applies, 500 ms later)', () => {
  it('starts with nothing typed and nothing applied', () => {
    const { result } = renderHook(() => useSearchDraft());
    expect(result.current.draft).toBe('');
    expect(result.current.query).toBe('');
  });

  it('shows what is typed at once and applies it only after the delay', () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.change('alp');
    });
    expect(result.current.draft).toBe('alp');
    expect(result.current.query).toBe('');
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS - 1);
    });
    expect(result.current.query).toBe('');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.query).toBe('alp');
  });

  it('is 500 ms, as the plan says', () => {
    expect(SEARCH_DELAY_MS).toBe(500);
  });

  it('restarts the delay with every key, so only the last text is applied', () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.change('a');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      result.current.change('al');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.query).toBe('');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.query).toBe('al');
  });

  it('applies the draft at once on flush (Enter), and leaves no timer behind', () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.change('beta');
    });
    act(() => {
      result.current.flush();
    });
    expect(result.current.query).toBe('beta');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes the text typed in the same breath, not the one of the last render', () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.change('be');
      result.current.change('beta');
      result.current.flush();
    });
    expect(result.current.query).toBe('beta');
  });

  it('applies a cleared draft at once: an empty search is no search, and needs no delay', () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.change('beta');
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(result.current.query).toBe('beta');
    act(() => {
      result.current.change('');
    });
    expect(result.current.draft).toBe('');
    expect(result.current.query).toBe('');
  });

  it('drops a pending text when the draft is cleared before the delay ends', () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.change('beta');
    });
    act(() => {
      result.current.change('');
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS * 2);
    });
    expect(result.current.query).toBe('');
  });

  it('clears the draft, the query and the pending text together', () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.change('beta');
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    act(() => {
      result.current.change('betas');
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.draft).toBe('');
    expect(result.current.query).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when it unmounts with a text pending', () => {
    const { result, unmount } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.change('beta');
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
