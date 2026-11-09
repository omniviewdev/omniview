import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  byteToUTF16,
  editToUTF16,
  spanToUTF16,
  utf16SpanToByte,
  utf16ToByte,
  utf8ByteLength,
} from './authoringUnits';

interface VectorCase {
  name: string;
  source: string;
  /** [utf8 byte, Unicode scalar, UTF-16 code unit] */
  boundaries: [number, number, number][];
}

const vectors = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../backend/pkg/resourceauthoring/testdata/units.json'),
    'utf8',
  ),
) as { cases: VectorCase[] };

describe('units.json conformance', () => {
  for (const vector of vectors.cases) {
    it(`${vector.name}: boundaries convert both ways`, () => {
      for (const [byte, , unit] of vector.boundaries) {
        expect(byteToUTF16(vector.source, byte)).toBe(unit);
        expect(utf16ToByte(vector.source, unit)).toBe(byte);
      }
      const last = vector.boundaries[vector.boundaries.length - 1];
      expect(utf8ByteLength(vector.source)).toBe(last[0]);
      expect(vector.source.length).toBe(last[2]);
    });

    it(`${vector.name}: non-boundaries throw`, () => {
      const bytes = new Set(vector.boundaries.map((b) => b[0]));
      const units = new Set(vector.boundaries.map((b) => b[2]));
      const byteMax = vector.boundaries[vector.boundaries.length - 1][0];
      const unitMax = vector.boundaries[vector.boundaries.length - 1][2];
      for (let byte = 0; byte <= byteMax; byte++) {
        if (!bytes.has(byte)) expect(() => byteToUTF16(vector.source, byte)).toThrow(RangeError);
      }
      for (let unit = 0; unit <= unitMax; unit++) {
        if (!units.has(unit)) expect(() => utf16ToByte(vector.source, unit)).toThrow(RangeError);
      }
      expect(() => byteToUTF16(vector.source, byteMax + 1)).toThrow(RangeError);
      expect(() => utf16ToByte(vector.source, unitMax + 1)).toThrow(RangeError);
      expect(() => byteToUTF16(vector.source, -1)).toThrow(RangeError);
      expect(() => utf16ToByte(vector.source, -1)).toThrow(RangeError);
      expect(() => byteToUTF16(vector.source, 0.5)).toThrow(RangeError);
      expect(() => utf16ToByte(vector.source, Number.NaN)).toThrow(RangeError);
    });
  }
});

describe('spans', () => {
  const source = 'a\u00e9\u0301\ud83d\ude00';
  it('convert both ways', () => {
    expect(spanToUTF16(source, 1, 9)).toEqual([1, 5]);
    expect(utf16SpanToByte(source, 1, 5)).toEqual([1, 9]);
  });
  it('reject inverted and splitting spans', () => {
    expect(() => spanToUTF16(source, 3, 1)).toThrow(RangeError);
    expect(() => utf16SpanToByte(source, 3, 1)).toThrow(RangeError);
    expect(() => spanToUTF16(source, 1, 2)).toThrow(RangeError);
    expect(() => utf16SpanToByte(source, 1, 4)).toThrow(RangeError);
  });
});

describe('lone surrogates', () => {
  it('are rejected everywhere', () => {
    for (const source of ['\ud83d', '\ude00', 'a\ud83dx', '\ude00\ud83d']) {
      expect(() => utf8ByteLength(source)).toThrow(RangeError);
      expect(() => byteToUTF16(source, 0)).toThrow(RangeError);
      expect(() => utf16ToByte(source, 0)).toThrow(RangeError);
      expect(() => applyEdit(source, { start: 0, end: 0, unit: 'utf8-byte', text: '' })).toThrow(RangeError);
    }
    expect(() => applyEdit('a', { start: 0, end: 0, unit: 'utf8-byte', text: '\ud83d' })).toThrow(RangeError);
  });
});

describe('applyEdit', () => {
  const unit = 'utf8-byte' as const;
  it('applies byte coordinates to a multi-byte source', () => {
    // "雪😀x": bytes 0-3 snow, 3-7 emoji, 7-8 x
    expect(applyEdit('\u96ea\ud83d\ude00x', { start: 3, end: 7, unit, text: 'y' })).toBe('\u96eayx');
  });
  it('inserts text containing supplementary characters', () => {
    expect(applyEdit('ab', { start: 1, end: 1, unit, text: '\ud83d\ude00\u96ea' })).toBe('a\ud83d\ude00\u96eab');
    expect(applyEdit('\ud83d\ude00', { start: 4, end: 4, unit, text: '\ud83d\ude01' })).toBe('\ud83d\ude00\ud83d\ude01');
  });
  it('rejects splitting, inverted, out-of-range and wrong-unit edits', () => {
    expect(() => applyEdit('\u00e9', { start: 1, end: 2, unit, text: '' })).toThrow(RangeError);
    expect(() => applyEdit('abc', { start: 2, end: 1, unit, text: '' })).toThrow(RangeError);
    expect(() => applyEdit('abc', { start: 0, end: 4, unit, text: '' })).toThrow(RangeError);
    expect(() => applyEdit('abc', { start: -1, end: 1, unit, text: '' })).toThrow(RangeError);
    expect(() =>
      applyEdit('abc', { start: 0, end: 1, unit: 'utf16' as unknown as 'utf8-byte', text: '' }),
    ).toThrow(RangeError);
  });
});

describe('editToUTF16', () => {
  const unit = 'utf8-byte' as const;
  it('converts the span against the source and the selection against the text', () => {
    const source = '\ud83d\ude00 x == 1';
    const text = '\u96ea\ud83d\ude00 == ';
    const edit = editToUTF16(source, {
      start: 5,
      end: 6,
      unit,
      text,
      // selection after the emoji (3+4 bytes) inside text
      selection: { start: 7, end: 7, unit },
    });
    expect(edit).toEqual({ start: 3, end: 4, text, selection: { start: 3, end: 3 } });
  });
  it('omits selection when absent and rejects a selection splitting the text', () => {
    expect(editToUTF16('abc', { start: 0, end: 1, unit, text: 'z' })).toEqual({ start: 0, end: 1, text: 'z' });
    expect(() =>
      editToUTF16('abc', { start: 0, end: 1, unit, text: '\ud83d\ude00', selection: { start: 2, end: 2, unit } }),
    ).toThrow(RangeError);
  });
  it('rejects edits splitting the source', () => {
    expect(() => editToUTF16('\u00e9', { start: 1, end: 1, unit, text: '' })).toThrow(RangeError);
  });
});
