// The display buffer (HLT-4, MNR-L2): one bounded ring of entries, a head that is overwritten and counted when it is full, and ordinals that
// are never reused, so a row, a selection and a search match name a line that stays the same line while the older ones go.
import { describe, expect, it } from 'vitest';
import { LineBuffer } from './lineBuffer';
import type { GapEntry, LineEntry } from './types';

const line = (n: number, text = `line ${n}`): LineEntry => ({ kind: 'line', n, seq: n, source: '', timestamp: '', text, level: undefined, runs: undefined });
const gap = (n: number, dropped = 3): GapEntry => ({ kind: 'gap', n, dropped });

describe('LineBuffer', () => {
  it('starts empty: nothing held, nothing evicted, the first ordinal is 1', () => {
    const buffer = new LineBuffer(10);
    expect([buffer.length, buffer.first, buffer.next, buffer.evicted, buffer.evictedLines]).toEqual([0, 1, 1, 0, 0]);
  });

  it('holds entries oldest first by index and by ordinal', () => {
    const buffer = new LineBuffer(10);
    for (let n = 1; n <= 4; n += 1) {
      buffer.push(line(n));
    }

    expect(buffer.length).toBe(4);
    expect([0, 1, 2, 3].map((index) => buffer.at(index).n)).toEqual([1, 2, 3, 4]);
    expect(buffer.byOrdinal(3)?.n).toBe(3);
    expect(buffer.byOrdinal(0)).toBeUndefined();
    expect(buffer.byOrdinal(5)).toBeUndefined();
    expect(buffer.next).toBe(5);
  });

  it('refuses an entry that is not the next ordinal: the ordinal names a line for good', () => {
    const buffer = new LineBuffer(10);
    buffer.push(line(1));
    expect(() => buffer.push(line(3))).toThrow(RangeError);
    expect(() => buffer.push(line(1))).toThrow(RangeError);
  });

  it('refuses a capacity that is not a positive integer', () => {
    expect(() => new LineBuffer(0)).toThrow(RangeError);
    expect(() => new LineBuffer(2.5)).toThrow(RangeError);
  });

  it('100,100 appends leave 100,000 and count the 100 evicted (HLT-4)', () => {
    const buffer = new LineBuffer(100_000);
    for (let n = 1; n <= 100_100; n += 1) {
      buffer.push(line(n));
    }

    expect(buffer.length).toBe(100_000);
    expect(buffer.evicted).toBe(100);
    expect(buffer.evictedLines).toBe(100);
    expect(buffer.first).toBe(101);
    expect(buffer.next).toBe(100_101);
    expect(buffer.at(0).n).toBe(101);
    expect(buffer.at(99_999).n).toBe(100_100);
    expect(buffer.byOrdinal(100)).toBeUndefined();
    expect(buffer.byOrdinal(101)?.n).toBe(101);
  });

  it('gives back the entry an append pushed out, and only then', () => {
    const buffer = new LineBuffer(2);
    expect(buffer.push(line(1))).toBeUndefined();
    expect(buffer.push(line(2))).toBeUndefined();
    expect(buffer.push(line(3))?.n).toBe(1);
    expect(buffer.push(line(4))?.n).toBe(2);
  });

  it('counts evicted lines apart from evicted markers: a gap is not a line that was lost', () => {
    const buffer = new LineBuffer(3);
    buffer.push(gap(1));
    buffer.push(line(2));
    buffer.push(line(3));
    buffer.push(line(4));
    buffer.push(line(5));
    expect(buffer.evicted).toBe(2);
    expect(buffer.evictedLines).toBe(1);
  });

  it('counts the lines it holds apart from the markers, through evictions', () => {
    const buffer = new LineBuffer(3);
    buffer.push(gap(1));
    buffer.push(line(2));
    buffer.push(line(3));
    expect([buffer.length, buffer.lines]).toEqual([3, 2]);
    buffer.push(line(4));
    expect([buffer.length, buffer.lines]).toEqual([3, 3]);
    buffer.push(gap(5));
    expect([buffer.length, buffer.lines]).toEqual([3, 2]);
  });

  it('stays correct across many wraps of the ring', () => {
    const buffer = new LineBuffer(7);
    for (let n = 1; n <= 1000; n += 1) {
      buffer.push(line(n));
      expect(buffer.at(buffer.length - 1).n).toBe(n);
      expect(buffer.at(0).n).toBe(Math.max(1, n - 6));
    }
  });
});

describe('LineBuffer.resize', () => {
  it('grows without losing an entry, and the entries keep their order and their ordinals, across the wrap of the ring', () => {
    const buffer = new LineBuffer(4);
    for (let n = 1; n <= 6; n += 1) {
      buffer.push(line(n));
    }

    // Held: 3 to 6, the head not at the start of the storage.
    expect(buffer.resize(10)).toEqual([]);
    expect(buffer.capacity).toBe(10);
    expect([0, 1, 2, 3].map((index) => buffer.at(index).n)).toEqual([3, 4, 5, 6]);
    expect([buffer.first, buffer.next, buffer.length]).toEqual([3, 7, 4]);
    for (let n = 7; n <= 12; n += 1) {
      buffer.push(line(n));
    }

    expect(buffer.length).toBe(10);
    expect(buffer.at(0).n).toBe(3);
    expect(buffer.evicted).toBe(2);
    buffer.push(line(13));
    expect([buffer.at(0).n, buffer.evicted]).toEqual([4, 3]);
  });

  it('shrinks by giving up the oldest entries, oldest first, and counts them as evicted, lines and markers apart', () => {
    const buffer = new LineBuffer(8);
    buffer.push(gap(1));
    buffer.push(line(2));
    buffer.push(line(3));
    buffer.push(gap(4));
    buffer.push(line(5));
    buffer.push(line(6));
    const lost = buffer.resize(3);
    expect(lost.map((entry) => entry.n)).toEqual([1, 2, 3]);
    expect(buffer.capacity).toBe(3);
    expect([buffer.length, buffer.lines, buffer.first, buffer.next]).toEqual([3, 2, 4, 7]);
    expect([buffer.evicted, buffer.evictedLines]).toEqual([3, 2]);
    expect([0, 1, 2].map((index) => buffer.at(index).n)).toEqual([4, 5, 6]);
    expect(buffer.byOrdinal(3)).toBeUndefined();
    expect(buffer.byOrdinal(4)?.n).toBe(4);
    // It is a ring of the new size.
    buffer.push(line(7));
    expect([buffer.at(0).n, buffer.at(2).n, buffer.evicted]).toEqual([5, 7, 4]);
  });

  it('gives up nothing when what it holds fits the new capacity, and does nothing for the same capacity', () => {
    const buffer = new LineBuffer(10);
    buffer.push(line(1));
    buffer.push(line(2));
    expect(buffer.resize(2)).toEqual([]);
    expect(buffer.resize(2)).toEqual([]);
    expect([buffer.length, buffer.evicted]).toEqual([2, 0]);
  });

  it('refuses a capacity that is not a positive integer, and keeps what it has', () => {
    const buffer = new LineBuffer(4);
    buffer.push(line(1));
    expect(() => buffer.resize(0)).toThrow(RangeError);
    expect(() => buffer.resize(1.5)).toThrow(RangeError);
    expect([buffer.capacity, buffer.length]).toEqual([4, 1]);
  });

  describe('clear (the toolbar\'s Clear: the view forgets what it holds)', () => {
    it('empties the buffer, counts nothing as evicted and keeps the ordinals going: a cleared line is not a dropped one, and no ordinal is ever reused', () => {
      const buffer = new LineBuffer(3);
      for (let n = 1; n <= 5; n += 1) {
        buffer.push(line(n));
      }

      expect([buffer.length, buffer.first, buffer.next, buffer.evicted, buffer.evictedLines]).toEqual([3, 3, 6, 2, 2]);
      buffer.clear();
      expect([buffer.length, buffer.lines, buffer.first, buffer.next, buffer.evictedLines]).toEqual([0, 0, 6, 6, 0]);
      expect(buffer.byOrdinal(5)).toBeUndefined();
      expect(buffer.byOrdinal(6)).toBeUndefined();
    });

    it('lets the next entry in at the next ordinal, and takes none of the old', () => {
      const buffer = new LineBuffer(3);
      buffer.push(line(1));
      buffer.push(gap(2));
      buffer.clear();
      expect(() => buffer.push(line(2))).toThrow(RangeError);
      buffer.push(line(3));
      expect([buffer.length, buffer.lines, buffer.first, buffer.at(0).n]).toEqual([1, 1, 3, 3]);
    });

    it('counts a marker that was held as no marker: the lines it holds are the lines after the clear', () => {
      const buffer = new LineBuffer(4);
      buffer.push(gap(1));
      buffer.push(line(2));
      buffer.clear();
      buffer.push(line(3));
      expect([buffer.length, buffer.lines]).toEqual([1, 1]);
    });

    it('still evicts, and counts, the lines that come after it past its capacity', () => {
      const buffer = new LineBuffer(2);
      buffer.push(line(1));
      buffer.clear();
      for (let n = 2; n <= 5; n += 1) {
        buffer.push(line(n));
      }

      expect([buffer.length, buffer.evictedLines, buffer.first]).toEqual([2, 2, 4]);
    });

    it('holds nothing of the old lines: a ring written after the clear never hands an old entry back as the one it overwrote', () => {
      const buffer = new LineBuffer(3);
      buffer.push(line(1));
      buffer.push(line(2));
      buffer.push(line(3));
      buffer.clear();
      const gone: Array<number | undefined> = [];
      for (let n = 4; n <= 9; n += 1) {
        gone.push(buffer.push(line(n))?.n);
      }

      expect(gone).toEqual([undefined, undefined, undefined, 4, 5, 6]);
    });
  });
});
