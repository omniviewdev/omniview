// The lines the viewer shows: the whole buffer, or only those at or above a minimum level (the mock's All / Info+ / Warn+ / Error). A view over the whole
// buffer holds no index of its own; a filtered one holds the ordinals that pass, kept in step with the buffer as lines come and the head goes.
import { describe, expect, it } from 'vitest';
import { LineBuffer } from './lineBuffer';
import { LineView, LEVEL_RANK } from './lineView';
import type { GapEntry, LineEntry, LogLevel } from './types';

const line = (n: number, level?: LogLevel): LineEntry => ({ kind: 'line', n, seq: n, source: '', timestamp: '', text: `line ${n}`, level, runs: undefined });
const gap = (n: number): GapEntry => ({ kind: 'gap', n, dropped: 5 });

/** Pushes entries through the buffer and the view the way the model does: the buffer first, then the view learns of the entry and of the eviction. */
function feed(buffer: LineBuffer, view: LineView, entries: ReadonlyArray<(n: number) => LineEntry | GapEntry>) {
  for (const make of entries) {
    const evicted = buffer.push(make(buffer.next));
    view.pushed(buffer.at(buffer.length - 1), evicted);
  }
}

const ordinals = (view: LineView) => Array.from({ length: view.length }, (_, index) => view.ordinalAt(index));

describe('the ranks', () => {
  it('put debug and trace at 0, info at 1, warn at 2 and error at 3, as the mock does', () => {
    expect(LEVEL_RANK).toEqual({ trace: 0, debug: 0, info: 1, warn: 2, error: 3 });
  });
});

describe('a view of everything', () => {
  it('mirrors the buffer, by index and by ordinal, with no index of its own', () => {
    const buffer = new LineBuffer(5);
    const view = new LineView(buffer);
    feed(buffer, view, [(n) => line(n), (n) => gap(n), (n) => line(n, 'error')]);
    expect(view.length).toBe(3);
    expect(view.indexSize).toBe(0);
    expect(ordinals(view)).toEqual([1, 2, 3]);
    expect(view.at(2).n).toBe(3);
    expect(view.lowerBound(2)).toBe(1);
    expect(view.lowerBound(99)).toBe(3);
    expect(view.lowerBound(0)).toBe(0);
  });

  it('follows the head as the ring overwrites it', () => {
    const buffer = new LineBuffer(3);
    const view = new LineView(buffer);
    feed(buffer, view, Array.from({ length: 10 }, () => (n: number) => line(n)));
    expect(ordinals(view)).toEqual([8, 9, 10]);
    expect(view.lowerBound(9)).toBe(1);
    expect(view.lowerBound(3)).toBe(0);
  });
});

describe('a view at or above a minimum level', () => {
  const mixed: ReadonlyArray<(n: number) => LineEntry | GapEntry> = [
    (n) => line(n, 'debug'), // 1
    (n) => line(n, 'info'), // 2
    (n) => line(n), // 3  no level: counts as info, as the mock does (LEVEL_RANK[level] ?? 1)
    (n) => line(n, 'warn'), // 4
    (n) => gap(n), // 5  a marker always shows
    (n) => line(n, 'error'), // 6
    (n) => line(n, 'trace'), // 7
  ];

  it.each([
    [0, [1, 2, 3, 4, 5, 6, 7]],
    [1, [2, 3, 4, 5, 6]],
    [2, [4, 5, 6]],
    [3, [5, 6]],
  ])('rank %i shows %j', (rank, expected) => {
    const buffer = new LineBuffer(20);
    const view = new LineView(buffer);
    feed(buffer, view, mixed);
    view.setMinRank(rank);
    expect(ordinals(view)).toEqual(expected);
    expect(view.length).toBe(expected.length);
    expected.forEach((n, index) => {
      expect(view.at(index).n).toBe(n);
    });
  });

  it('learns of the lines that come after the rank was set, and ignores those below it', () => {
    const buffer = new LineBuffer(20);
    const view = new LineView(buffer);
    view.setMinRank(2);
    feed(buffer, view, [(n) => line(n, 'info'), (n) => line(n, 'warn'), (n) => line(n, 'debug'), (n) => line(n, 'error')]);
    expect(ordinals(view)).toEqual([2, 4]);
  });

  it('drops the ordinals of evicted entries from its head', () => {
    const buffer = new LineBuffer(4);
    const view = new LineView(buffer);
    view.setMinRank(2);
    feed(buffer, view, [(n) => line(n, 'error'), (n) => line(n, 'info'), (n) => line(n, 'warn'), (n) => line(n, 'info'), (n) => line(n, 'error'), (n) => line(n, 'info')]);
    // The buffer holds 3..6: warn(3), info(4), error(5), info(6).
    expect(ordinals(view)).toEqual([3, 5]);
    expect(view.at(0).n).toBe(3);
  });

  it('finds the index of an ordinal by binary search over what it shows', () => {
    const buffer = new LineBuffer(50);
    const view = new LineView(buffer);
    feed(buffer, view, Array.from({ length: 40 }, (_, index) => (n: number) => line(n, index % 5 === 0 ? 'error' : 'info')));
    view.setMinRank(3);
    // Ordinals 1, 6, 11, ... 36 pass.
    expect(view.length).toBe(8);
    expect(view.lowerBound(1)).toBe(0);
    expect(view.lowerBound(2)).toBe(1);
    expect(view.lowerBound(11)).toBe(2);
    expect(view.lowerBound(37)).toBe(8);
  });

  it('counts the lines it shows, markers left out, through evictions', () => {
    const buffer = new LineBuffer(5);
    const view = new LineView(buffer);
    view.setMinRank(2);
    feed(buffer, view, [(n) => line(n, 'error'), (n) => gap(n), (n) => line(n, 'info'), (n) => line(n, 'warn'), (n) => line(n, 'error')]);
    expect([view.length, view.lineCount]).toEqual([4, 3]);
    feed(buffer, view, [(n) => line(n, 'error')]);
    // The first error went: three lines and a marker remain.
    expect([view.length, view.lineCount]).toEqual([4, 3]);
    feed(buffer, view, [(n) => line(n, 'info')]);
    // The marker went.
    expect([view.length, view.lineCount]).toEqual([3, 3]);
    view.setMinRank(0);
    expect(view.lineCount).toBe(buffer.lines);
  });

  it('goes back to the whole buffer', () => {
    const buffer = new LineBuffer(20);
    const view = new LineView(buffer);
    feed(buffer, view, mixed);
    view.setMinRank(3);
    view.setMinRank(0);
    expect(ordinals(view)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(view.indexSize).toBe(0);
  });

  it('keeps its index small however many lines come: the head is compacted', () => {
    const buffer = new LineBuffer(1000);
    const view = new LineView(buffer);
    view.setMinRank(1);
    feed(buffer, view, Array.from({ length: 50_000 }, () => (n: number) => line(n, 'info')));
    expect(view.length).toBe(1000);
    expect(view.at(0).n).toBe(49_001);
    expect(view.indexSize).toBeLessThan(4 * 1000 + 8192);
  });
});

describe('a view when the buffer shrinks', () => {
  it('forgets the entries the buffer gave up, and counts the lines that remain: a view of everything and a filtered one', () => {
    const buffer = new LineBuffer(10);
    const view = new LineView(buffer);
    feed(buffer, view, [(n) => line(n, 'info'), (n) => gap(n), (n) => line(n, 'error'), (n) => line(n, 'warn'), (n) => line(n, 'error'), (n) => line(n, 'info')]);
    expect(view.shrunk(buffer.resize(4))).toBe(2);
    expect([ordinals(view), view.lineCount]).toEqual([[3, 4, 5, 6], 4]);

    const filtered = new LineBuffer(10);
    const errors = new LineView(filtered);
    feed(filtered, errors, [(n) => line(n, 'info'), (n) => gap(n), (n) => line(n, 'error'), (n) => line(n, 'warn'), (n) => line(n, 'error'), (n) => line(n, 'info')]);
    errors.setMinRank(3);
    // The marker and the two errors pass; the first error and the marker go with the head, so one entry and one line remain of three entries and two lines.
    expect(errors.length).toBe(3);
    expect(errors.shrunk(filtered.resize(3))).toBe(2);
    expect([ordinals(errors), errors.lineCount]).toEqual([[5], 1]);
  });

  it('drops nothing from a view for a buffer that only grew', () => {
    const buffer = new LineBuffer(3);
    const view = new LineView(buffer);
    view.setMinRank(2);
    feed(buffer, view, [(n) => line(n, 'warn'), (n) => line(n, 'error')]);
    expect(view.shrunk(buffer.resize(9))).toBe(0);
    expect([ordinals(view), view.lineCount]).toEqual([[1, 2], 2]);
  });
});
