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
    // The marker reached the head and stayed as the lead (L1): it is not a line, so the count of lines is the same.
    expect([view.length, view.lineCount]).toEqual([4, 3]);
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
    // The first line and the marker go; the marker stays as the lead (L1), so one row left the list, and the lead is numbered one before the first line held.
    expect(view.shrunk(buffer.resize(4))).toBe(1);
    expect([ordinals(view), view.lineCount]).toEqual([[2, 3, 4, 5, 6], 4]);

    const filtered = new LineBuffer(10);
    const errors = new LineView(filtered);
    feed(filtered, errors, [(n) => line(n, 'info'), (n) => gap(n), (n) => line(n, 'error'), (n) => line(n, 'warn'), (n) => line(n, 'error'), (n) => line(n, 'info')]);
    errors.setMinRank(3);
    // The marker and the two errors pass; the first error and the marker go with the head, and the marker stays as the lead (L1): one row left the list, and the lead and one line remain.
    expect(errors.length).toBe(3);
    expect(errors.shrunk(filtered.resize(3))).toBe(1);
    expect([ordinals(errors), errors.lineCount]).toEqual([[3, 5], 1]);
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

// A marker that reaches the head of a full buffer is not given up with the lines: it stays as the first row of the view, for the lines it stands for, while the view holds any
// line (L1). The lines the feed dropped are lost without the reader being told, otherwise: a catch-up of a whole buffer pushes the marker out in the frame that appended it.
describe('a marker that reaches the head', () => {
  const gapOf = (dropped: number) => (n: number): GapEntry => ({ kind: 'gap', n, dropped });

  it('stays as the first row when the lines behind it go, and says what it stood for', () => {
    const buffer = new LineBuffer(4);
    const view = new LineView(buffer);
    feed(buffer, view, [gapOf(30), (n) => line(n), (n) => line(n), (n) => line(n), (n) => line(n)]);
    // The ring pushed the marker out of its head to make room for the fourth line; the view keeps it, one row beyond the buffer's own bound.
    expect(buffer.length).toBe(4);
    expect(view.length).toBe(5);
    expect(view.at(0)).toMatchObject({ kind: 'gap', dropped: 30 });
    expect(view.at(1).n).toBe(buffer.first);
    expect(view.lineCount).toBe(4);

    feed(buffer, view, Array.from({ length: 10 }, () => (n: number) => line(n)));
    expect([view.length, view.at(0).kind, view.at(1).kind, view.lineCount]).toEqual([5, 'gap', 'line', 4]);
    expect(view.at(0)).toMatchObject({ dropped: 30 });
  });

  it('numbers the row one before the oldest line, so the ordinals of the view stay in a row', () => {
    const buffer = new LineBuffer(3);
    const view = new LineView(buffer);
    feed(buffer, view, [gapOf(9), (n) => line(n), (n) => line(n), (n) => line(n), (n) => line(n), (n) => line(n)]);
    expect(ordinals(view)).toEqual([buffer.first - 1, ...Array.from({ length: 3 }, (_, index) => buffer.first + index)]);
    expect(view.lowerBound(0)).toBe(0);
    expect(view.lowerBound(buffer.first - 1)).toBe(0);
    expect(view.lowerBound(buffer.first)).toBe(1);
    expect(view.lowerBound(buffer.next)).toBe(4);
  });

  it('is told apart by what the feed dropped: two that reach the head are one row for their sum', () => {
    const buffer = new LineBuffer(3);
    const view = new LineView(buffer);
    feed(buffer, view, [(n) => line(n), gapOf(4), (n) => line(n), gapOf(6), (n) => line(n), (n) => line(n), (n) => line(n), (n) => line(n)]);
    expect(view.at(0)).toMatchObject({ kind: 'gap', dropped: 10 });
    expect(Array.from({ length: view.length }, (_, index) => view.at(index).kind)).toEqual(['gap', 'line', 'line', 'line']);
  });

  it('leaves a marker that still has lines behind it where it is', () => {
    const buffer = new LineBuffer(5);
    const view = new LineView(buffer);
    feed(buffer, view, [(n) => line(n), (n) => line(n), gapOf(7), (n) => line(n), (n) => line(n), (n) => line(n)]);
    // The first line went; the marker is second, and is no lead: the line before it is held.
    expect(Array.from({ length: view.length }, (_, index) => view.at(index).kind)).toEqual(['line', 'gap', 'line', 'line', 'line']);
  });

  it('says how many rows left the top of the list, the lead taking the place of the marker that became it', () => {
    const buffer = new LineBuffer(3);
    const view = new LineView(buffer);
    const left: number[] = [];
    for (const make of [gapOf(5), (n: number) => line(n), (n: number) => line(n), (n: number) => line(n), (n: number) => line(n), (n: number) => line(n)]) {
      const evicted = buffer.push(make(buffer.next));
      left.push(view.pushed(buffer.at(buffer.length - 1), evicted));
    }

    // Nothing left until the ring was full; the marker became the lead (no row left: it is where it was); each line after it pushed one line out.
    expect(left).toEqual([0, 0, 0, 0, 1, 1]);
  });

  it('counts the lead in a filtered view and keeps the lines it shows', () => {
    const buffer = new LineBuffer(4);
    const view = new LineView(buffer);
    view.setMinRank(3);
    const left: number[] = [];
    for (const make of [gapOf(8), (n: number) => line(n, 'error'), (n: number) => line(n, 'info'), (n: number) => line(n, 'error'), (n: number) => line(n, 'error'), (n: number) => line(n, 'info'), (n: number) => line(n, 'error')]) {
      const evicted = buffer.push(make(buffer.next));
      left.push(view.pushed(buffer.at(buffer.length - 1), evicted));
    }

    // The ring holds the entries 4 to 7 (error, error, info, error): the view shows the lead and the three errors.
    expect(view.at(0)).toMatchObject({ kind: 'gap', dropped: 8 });
    const kinds = Array.from({ length: view.length }, (_, index) => view.at(index));
    expect(kinds.slice(1).every((entry) => entry.kind === 'line' && entry.level === 'error')).toBe(true);
    expect(view.lineCount).toBe(kinds.length - 1);
    expect(view.ordinalAt(0)).toBe(buffer.first - 1);
    expect(view.lowerBound(buffer.first)).toBe(1);
    expect(left.every((count) => count >= 0)).toBe(true);
    // Back to everything: the lead is the first row of the whole buffer too.
    view.setMinRank(0);
    expect(view.length).toBe(buffer.length + 1);
    expect(view.at(0)).toMatchObject({ kind: 'gap', dropped: 8 });
  });

  it('takes the markers a smaller buffer gives up, as it takes those a full ring overwrites', () => {
    const buffer = new LineBuffer(10);
    const view = new LineView(buffer);
    feed(buffer, view, [(n) => line(n), gapOf(3), (n) => line(n), (n) => line(n), (n) => line(n), (n) => line(n)]);
    // 1 line, a marker, 4 lines; a buffer of 3 gives up the first line, the marker and one line.
    expect(view.shrunk(buffer.resize(3))).toBe(2);
    expect(view.at(0)).toMatchObject({ kind: 'gap', dropped: 3 });
    expect(view.length).toBe(4);
    expect(view.lineCount).toBe(3);
  });
});

describe('reset (the toolbar\'s Clear)', () => {
  const gapOf = (dropped: number) => (n: number): GapEntry => ({ kind: 'gap', n, dropped });

  it('shows nothing and keeps the level the reader chose', () => {
    const buffer = new LineBuffer(10);
    const view = new LineView(buffer);
    feed(buffer, view, [(n) => line(n, 'debug'), (n) => line(n, 'warn'), (n) => line(n, 'error')]);
    view.setMinRank(2);
    expect(ordinals(view)).toEqual([2, 3]);
    buffer.clear();
    view.reset();
    expect([view.length, view.lineCount, view.rank, view.indexSize]).toEqual([0, 0, 2, 0]);
    // The lines that come now are filtered as before.
    feed(buffer, view, [(n) => line(n, 'info'), (n) => line(n, 'error')]);
    expect(ordinals(view)).toEqual([5]);
    expect(view.lineCount).toBe(1);
  });

  it('forgets the lead: what a marker that reached the head stood for is cleared with the lines, and says nothing after', () => {
    const buffer = new LineBuffer(3);
    const view = new LineView(buffer);
    feed(buffer, view, [gapOf(8), (n) => line(n), (n) => line(n), (n) => line(n)]);
    expect(view.at(0)).toMatchObject({ kind: 'gap', dropped: 8 });
    buffer.clear();
    view.reset();
    expect(view.length).toBe(0);
    feed(buffer, view, [(n) => line(n)]);
    expect(view.length).toBe(1);
    expect(view.at(0).kind).toBe('line');
    expect(view.ordinalAt(0)).toBe(buffer.first);
  });

  it('a view of everything is the buffer again, with no index', () => {
    const buffer = new LineBuffer(5);
    const view = new LineView(buffer);
    feed(buffer, view, [(n) => line(n), (n) => line(n)]);
    buffer.clear();
    view.reset();
    feed(buffer, view, [(n) => line(n)]);
    expect([view.length, view.indexSize, view.ordinalAt(0), view.lowerBound(3)]).toEqual([1, 0, 3, 0]);
  });
});
