import { describe, expect, it } from 'vitest';
import type { ActivityProgress } from '../activity';
import { progressOf } from './progress';

// What a row of Operations says of how far the work is (ch16 S122; the mock's `progressFace`, shell-panel.js:2268, "the record's own progress, never a percentage the panel derived (X6)"): the producer's words, and the part of the
// 4 px bar that is done. The producer's numbers are decimal STRINGS because a double cannot hold every count the host keeps, so the arithmetic is exact (BigInt) and the bar is told a fraction, never a double made of a double.

const units = (current: string, total: string, unit: string): ActivityProgress => ({ kind: 'units', current, total, unit });
const steps = (current: string, total: string, label = ''): ActivityProgress => ({ kind: 'steps', current, total, label });

describe('units: the producer\'s count and its unit', () => {
  it('says "<current> of <total> <unit>" and draws the part that is done', () => {
    const face = progressOf(units('6', '14', 'files'));
    expect(face?.text).toBe('6 of 14 files');
    expect(face?.fraction).toBeCloseTo(6 / 14, 5);
  });

  it('says a percent as one number, the way the mock does: "40%"', () => {
    expect(progressOf(units('40', '100', '%'))).toEqual({ text: '40%', fraction: 0.4 });
  });

  it('leaves no trailing space when the producer names no unit', () => {
    expect(progressOf(units('6', '14', ''))?.text).toBe('6 of 14');
  });

  it('groups thousands with a comma, as the mock\'s num() and the collection footer do', () => {
    expect(progressOf(units('1204', '5000', 'rows'))?.text).toBe('1,204 of 5,000 rows');
    expect(progressOf(units('1000000', '1000000', 'rows'))?.text).toBe('1,000,000 of 1,000,000 rows');
  });

  it('draws an empty bar, not none, for work that has not done a unit yet', () => {
    expect(progressOf(units('0', '14', 'files'))).toEqual({ text: '0 of 14 files', fraction: 0 });
  });

  it('draws a full bar for a count that is done, and for one that went past its whole, and says what the producer said', () => {
    expect(progressOf(units('14', '14', 'files'))).toEqual({ text: '14 of 14 files', fraction: 1 });
    expect(progressOf(units('15', '14', 'files'))).toEqual({ text: '15 of 14 files', fraction: 1 });
  });

  it('reads the digits, not the spelling: leading zeros are not part of a count', () => {
    expect(progressOf(units('007', '014', 'files'))).toEqual({ text: '7 of 14 files', fraction: 0.5 });
  });
});

describe('steps: "<current> of <total>", whatever the step is called', () => {
  it('says the two numbers and draws the part that is done', () => {
    expect(progressOf(steps('2', '5', 'Compile'))).toEqual({ text: '2 of 5', fraction: 0.4 });
  });

  it('says the same with no label', () => {
    expect(progressOf(steps('2', '5'))?.text).toBe('2 of 5');
  });

  it('draws a full bar at the last step and never more', () => {
    expect(progressOf(steps('5', '5'))?.fraction).toBe(1);
    expect(progressOf(steps('9', '5'))?.fraction).toBe(1);
  });
});

describe('no bar', () => {
  it('is nothing for work that cannot be measured, with or without the producer\'s message: a dash is drawn, never a bar made up', () => {
    expect(progressOf({ kind: 'indeterminate' })).toBeUndefined();
    expect(progressOf({ kind: 'indeterminate', message: 'Scanning' })).toBeUndefined();
  });

  it('is nothing when the producer said nothing', () => {
    expect(progressOf(undefined)).toBeUndefined();
  });

  it.each(['0', '00', '000'])('draws no bar when the whole is %s (a part of nothing), and still says what the producer said', (total) => {
    expect(progressOf(units('3', total, 'files'))).toEqual({ text: '3 of 0 files', fraction: undefined });
    expect(progressOf(steps('1', total))).toEqual({ text: '1 of 0', fraction: undefined });
  });

  // Anything that is not the digits 0 to 9 is not a count: a bar made of it would be a guess. The words are the producer's, so they are still said, as they came.
  it.each(['', '-1', '1.5', '1e3', '+5', ' 5', '5 ', '0x10', 'abc', '\u0663'])('draws no bar and says the producer\'s own %j when the current count is not decimal digits', (current) => {
    expect(progressOf(units(current, '10', 'files'))).toEqual({ text: `${current} of 10 files`, fraction: undefined });
    expect(progressOf(steps(current, '10'))).toEqual({ text: `${current} of 10`, fraction: undefined });
  });

  it.each(['', '-1', '1.5', '1e3', '+5', ' 5', '5 ', '0x10', 'abc', '\u0663'])('draws no bar and says the producer\'s own %j when the whole is not decimal digits', (total) => {
    expect(progressOf(units('5', total, 'files'))).toEqual({ text: `5 of ${total} files`, fraction: undefined });
    expect(progressOf(steps('5', total))).toEqual({ text: `5 of ${total}`, fraction: undefined });
  });

  it('says a percent whose number is not a count as the producer wrote it', () => {
    expect(progressOf(units('1.5', '100', '%'))).toEqual({ text: '1.5%', fraction: undefined });
  });

  it('groups the number that is digits and leaves the other as it came', () => {
    expect(progressOf(units('1234', 'many', 'files'))?.text).toBe('1,234 of many files');
  });
});

describe('exact for a count of any size', () => {
  it('does not round a count past 2^53 up to its whole: a double reads both of these as the same number, or as one that is nearly 1', () => {
    // 2^53 + 1 and 2^53 + 2: a double holds the first as 2^53, so a ratio of doubles is 0.9999999999999998 and a reader of that would say the work is done.
    const face = progressOf(units('9007199254740993', '9007199254740994', 'bytes'));
    expect(face?.fraction).toBe(0.999999);
    expect(face?.text).toBe('9,007,199,254,740,993 of 9,007,199,254,740,994 bytes');
  });

  it('does not call work that is one unit short of 10^30 complete', () => {
    const face = progressOf(units('999999999999999999999999999999', '1000000000000000000000000000000', 'bytes'));
    expect(face?.fraction).toBe(0.999999);
    expect(face?.fraction).toBeLessThan(1);
  });

  it('is a full bar only when the count reaches its whole', () => {
    const whole = '1000000000000000000000000000000';
    expect(progressOf(units(whole, whole, 'bytes'))?.fraction).toBe(1);
    expect(progressOf(units(`${whole}0`, whole, 'bytes'))?.fraction).toBe(1);
  });

  it('is exact beyond the range of a double (a double of 10^400 is Infinity, and Infinity over Infinity is not a number)', () => {
    const whole = `1${'0'.repeat(400)}`;
    const half = `5${'0'.repeat(399)}`;
    expect(progressOf(units(half, whole, 'bytes'))?.fraction).toBe(0.5);
    expect(progressOf(steps(half, whole))?.fraction).toBe(0.5);
  });

  it('keeps a part too small for the bar at the bar\'s precision: it is never rounded up to a bigger part', () => {
    // One in a million is the finest part the bar is told of; less than that is nothing yet, not a rounded-up sliver.
    expect(progressOf(units('1', '2000000', 'bytes'))?.fraction).toBe(0);
    expect(progressOf(units('1', '1000000', 'bytes'))?.fraction).toBe(0.000001);
  });
});
