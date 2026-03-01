import { renderHook, act } from '@testing-library/react';
import { useLogSearch } from '../useLogSearch';
import { MAX_MATCH_COUNT } from '../../utils/regexSafety';
import type { LogEntry } from '../../types';

/** Helper to build a minimal LogEntry with the given content. */
function entry(content: string, idx = 0): LogEntry {
  return {
    lineNumber: idx,
    sessionId: 's1',
    sourceId: 'src1',
    labels: {},
    timestamp: '',
    content,
    origin: 'CURRENT',
  };
}

describe('useLogSearch', () => {
  // ---------------------------------------------------------------------------
  // Basic behavior
  // ---------------------------------------------------------------------------

  it('returns no matches when query is empty', () => {
    const entries = [entry('hello'), entry('world')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    expect(result.current.matches).toEqual([]);
    expect(result.current.totalMatches).toBe(0);
    expect(result.current.capped).toBe(false);
  });

  it('finds all matches on initial search', () => {
    const entries = [entry('foo bar'), entry('baz'), entry('foo end')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));

    expect(result.current.matches).toHaveLength(2);
    expect(result.current.matches[0]).toEqual({
      lineIndex: 0,
      startOffset: 0,
      endOffset: 3,
    });
    expect(result.current.matches[1]).toEqual({
      lineIndex: 2,
      startOffset: 0,
      endOffset: 3,
    });
  });

  it('finds multiple matches per line', () => {
    const entries = [entry('foo foo foo')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));

    expect(result.current.matches).toHaveLength(3);
    expect(result.current.matches[0]).toEqual({ lineIndex: 0, startOffset: 0, endOffset: 3 });
    expect(result.current.matches[1]).toEqual({ lineIndex: 0, startOffset: 4, endOffset: 7 });
    expect(result.current.matches[2]).toEqual({ lineIndex: 0, startOffset: 8, endOffset: 11 });
  });

  // ---------------------------------------------------------------------------
  // Incremental search (same array ref, entries grow)
  // ---------------------------------------------------------------------------

  it('incrementally finds matches when entries grow (same array ref)', () => {
    // Use a mutable array — mirrors real useLogBuffer behavior
    const entries: LogEntry[] = [entry('foo bar'), entry('baz')];
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].lineIndex).toBe(0);

    // Mutate the same array (like useLogBuffer does)
    entries.push(entry('foo new'));
    version = 2;
    rerender();

    expect(result.current.matches).toHaveLength(2);
    // New match at index 2 — proves incremental search found it
    expect(result.current.matches[1].lineIndex).toBe(2);
  });

  it('incremental search appends only new matches (does not re-scan old entries)', () => {
    const entries: LogEntry[] = [entry('aaa'), entry('bbb')];
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('aaa'));
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].lineIndex).toBe(0);

    // Add entries where only one matches
    entries.push(entry('ccc'), entry('aaa again'));
    version = 2;
    rerender();

    expect(result.current.matches).toHaveLength(2);
    // First match unchanged, second at index 3
    expect(result.current.matches[0].lineIndex).toBe(0);
    expect(result.current.matches[1].lineIndex).toBe(3);
  });

  it('incremental search with no new matches keeps existing results', () => {
    const entries: LogEntry[] = [entry('foo bar')];
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(1);

    // Add entries with no matches
    entries.push(entry('baz'), entry('qux'));
    version = 2;
    rerender();

    // Should still have the same single match, not duplicated
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].lineIndex).toBe(0);
    expect(result.current.capped).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // No-change path (same ref, same length, same params)
  // ---------------------------------------------------------------------------

  it('returns cached results when only version changes but length is the same', () => {
    const entries: LogEntry[] = [entry('foo'), entry('bar')];
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(1);

    // Bump version without changing entries length — hits the no-change path
    version = 2;
    rerender();

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].lineIndex).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Full re-search triggers
  // ---------------------------------------------------------------------------

  it('does full re-search when query changes', () => {
    const entries = [entry('foo bar'), entry('bar baz'), entry('foo baz')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(2);

    act(() => result.current.setQuery('bar'));
    expect(result.current.matches).toHaveLength(2);
    expect(result.current.matches[0].lineIndex).toBe(0);
    expect(result.current.matches[1].lineIndex).toBe(1);
  });

  it('resets currentMatchIndex when query changes', () => {
    const entries = [entry('aaa'), entry('aaa'), entry('bbb')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('aaa'));
    act(() => result.current.nextMatch());
    expect(result.current.currentMatchIndex).toBe(1);

    act(() => result.current.setQuery('bbb'));
    expect(result.current.currentMatchIndex).toBe(0);
  });

  it('does full re-search when isRegex changes', () => {
    const entries = [entry('foo.bar'), entry('fooXbar')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    // Literal mode — dot is escaped, only matches "foo.bar"
    act(() => result.current.setQuery('foo.bar'));
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].lineIndex).toBe(0);

    // Switch to regex mode — dot matches any char
    act(() => result.current.setIsRegex(true));
    expect(result.current.matches).toHaveLength(2);
  });

  it('does full re-search when caseSensitive changes', () => {
    const entries = [entry('Hello'), entry('hello')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('hello'));
    // Case insensitive by default
    expect(result.current.matches).toHaveLength(2);

    act(() => result.current.setCaseSensitive(true));
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].lineIndex).toBe(1);
  });

  it('does full re-search when evictionCount changes', () => {
    // Use new array ref because eviction implies the buffer was spliced
    let entries = [entry('foo 1'), entry('foo 2'), entry('foo 3')];
    let version = 1;
    let evictionCount = 0;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(3);

    // Simulate eviction: remove first entry, bump evictionCount
    entries = [entry('foo 2'), entry('foo 3')];
    version = 2;
    evictionCount = 1;
    rerender();

    expect(result.current.matches).toHaveLength(2);
    expect(result.current.matches[0].lineIndex).toBe(0);
    expect(result.current.matches[1].lineIndex).toBe(1);
  });

  it('does full re-search when entries ref changes (filter toggle)', () => {
    const allEntries = [entry('foo 1'), entry('bar'), entry('foo 2')];
    let entries = allEntries;
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(2);

    // New array ref (simulates filter toggle)
    entries = [entry('foo 1'), entry('foo 2')];
    version = 2;
    rerender();

    expect(result.current.matches).toHaveLength(2);
    expect(result.current.matches[0].lineIndex).toBe(0);
    expect(result.current.matches[1].lineIndex).toBe(1);
  });

  it('does full re-search when entries shrink (same ref)', () => {
    const entries: LogEntry[] = [entry('foo a'), entry('foo b'), entry('foo c')];
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(3);

    // Shrink the same array
    entries.length = 1;
    version = 2;
    rerender();

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].lineIndex).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Capped behavior
  // ---------------------------------------------------------------------------

  it('skips new entries when already capped (same array ref)', () => {
    // Build a mutable array with enough matches to hit the cap
    const entries: LogEntry[] = Array.from(
      { length: MAX_MATCH_COUNT + 100 },
      (_, i) => entry('match', i),
    );
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('match'));
    expect(result.current.capped).toBe(true);
    const cappedCount = result.current.totalMatches;

    // Push more entries to the same array — should remain capped, count unchanged
    entries.push(entry('match'), entry('match'));
    version = 2;
    rerender();

    expect(result.current.capped).toBe(true);
    expect(result.current.totalMatches).toBe(cappedCount);
  });

  it('incremental search can reach the cap', () => {
    // Start near the cap
    const entries: LogEntry[] = Array.from(
      { length: MAX_MATCH_COUNT - 2 },
      (_, i) => entry('m', i),
    );
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('m'));
    expect(result.current.capped).toBe(false);
    expect(result.current.totalMatches).toBe(MAX_MATCH_COUNT - 2);

    // Add enough to exceed cap
    entries.push(entry('m'), entry('m'), entry('m'), entry('m'), entry('m'));
    version = 2;
    rerender();

    expect(result.current.capped).toBe(true);
    expect(result.current.totalMatches).toBe(MAX_MATCH_COUNT);
  });

  // ---------------------------------------------------------------------------
  // Clear / reset
  // ---------------------------------------------------------------------------

  it('resets to zero matches on clear (empty entries + eviction bump)', () => {
    let entries: LogEntry[] = [entry('foo'), entry('foo')];
    let version = 1;
    let evictionCount = 0;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(2);

    // Simulate clear
    entries = [];
    version = 2;
    evictionCount = 1;
    rerender();

    expect(result.current.matches).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Empty / edge cases
  // ---------------------------------------------------------------------------

  it('empty query returns no matches regardless of version changes', () => {
    let version = 1;
    const entries = [entry('foo')];

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    expect(result.current.matches).toHaveLength(0);

    version = 2;
    rerender();
    expect(result.current.matches).toHaveLength(0);
  });

  it('invalid regex returns no matches', () => {
    const entries = [entry('foo')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => {
      result.current.setIsRegex(true);
      result.current.setQuery('[unclosed');
    });

    expect(result.current.matches).toHaveLength(0);
  });

  it('empty-match regex pattern returns no matches', () => {
    const entries = [entry('foo')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => {
      result.current.setIsRegex(true);
      result.current.setQuery('.*');
    });

    expect(result.current.matches).toHaveLength(0);
  });

  it('handles query set while buffer is empty, then entries arrive', () => {
    let entries: LogEntry[] = [];
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('hello'));
    expect(result.current.matches).toHaveLength(0);

    // Entries arrive (new ref since we go from empty to populated)
    entries = [entry('hello world'), entry('goodbye')];
    version = 2;
    rerender();

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].lineIndex).toBe(0);
  });

  it('clearing query after having matches resets everything', () => {
    const entries = [entry('foo'), entry('foo')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('foo'));
    expect(result.current.matches).toHaveLength(2);

    act(() => result.current.setQuery(''));
    expect(result.current.matches).toHaveLength(0);
    expect(result.current.totalMatches).toBe(0);
    expect(result.current.capped).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Match navigation
  // ---------------------------------------------------------------------------

  it('nextMatch wraps around', () => {
    const entries = [entry('aaa'), entry('bbb'), entry('aaa')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('aaa'));
    expect(result.current.currentMatchIndex).toBe(0);

    act(() => result.current.nextMatch());
    expect(result.current.currentMatchIndex).toBe(1);

    act(() => result.current.nextMatch());
    expect(result.current.currentMatchIndex).toBe(0); // wrapped
  });

  it('prevMatch wraps around', () => {
    const entries = [entry('aaa'), entry('bbb'), entry('aaa')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('aaa'));
    expect(result.current.currentMatchIndex).toBe(0);

    act(() => result.current.prevMatch());
    expect(result.current.currentMatchIndex).toBe(1); // wrapped to last

    act(() => result.current.prevMatch());
    expect(result.current.currentMatchIndex).toBe(0);
  });

  it('nextMatch/prevMatch are no-ops when no matches exist', () => {
    const entries = [entry('foo')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('zzz'));
    expect(result.current.currentMatchIndex).toBe(0);

    act(() => result.current.nextMatch());
    expect(result.current.currentMatchIndex).toBe(0);

    act(() => result.current.prevMatch());
    expect(result.current.currentMatchIndex).toBe(0);
  });

  it('currentMatchIndex clamps when matches shrink below it', () => {
    const entries = [entry('aaa'), entry('aaa'), entry('aaa')];
    const { result } = renderHook(() =>
      useLogSearch({ entries, version: 1, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('aaa'));
    // Navigate to last match
    act(() => result.current.nextMatch());
    act(() => result.current.nextMatch());
    expect(result.current.currentMatchIndex).toBe(2);

    // Change query to something with fewer matches — resets index to 0
    act(() => result.current.setQuery('aab'));
    expect(result.current.currentMatchIndex).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Rapid sequential updates
  // ---------------------------------------------------------------------------

  it('handles multiple appends before asserting (RAF coalescing scenario)', () => {
    const entries: LogEntry[] = [entry('match 1')];
    let version = 1;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount: 0 }),
    );

    act(() => result.current.setQuery('match'));
    expect(result.current.matches).toHaveLength(1);

    // Simulate multiple appends coalesced into one version bump
    entries.push(entry('match 2'), entry('no'), entry('match 3'));
    version = 2;
    rerender();

    expect(result.current.matches).toHaveLength(3);
    expect(result.current.matches[1].lineIndex).toBe(1);
    expect(result.current.matches[2].lineIndex).toBe(3);
  });

  it('does not reset match index on eviction-triggered full re-search', () => {
    // Eviction triggers full re-search but should NOT reset currentMatchIndex
    // (only query/regex/case changes should reset it)
    let entries = [entry('foo a'), entry('foo b'), entry('foo c')];
    let version = 1;
    let evictionCount = 0;

    const { result, rerender } = renderHook(() =>
      useLogSearch({ entries, version, evictionCount }),
    );

    act(() => result.current.setQuery('foo'));
    act(() => result.current.nextMatch());
    expect(result.current.currentMatchIndex).toBe(1);

    // Evict — same matches but re-searched
    entries = [entry('foo a'), entry('foo b'), entry('foo c')];
    version = 2;
    evictionCount = 1;
    rerender();

    // Index is preserved (eviction doesn't reset it)
    expect(result.current.currentMatchIndex).toBe(1);
    expect(result.current.matches).toHaveLength(3);
  });
});
