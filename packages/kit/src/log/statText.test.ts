// The words of the status strip (the mock's `statText`, S120): how many lines, how fast, where the list is (following, scrolled back, paused), and what was
// dropped. A pure function of numbers, so the strip's text is one thing the tests pin.
import { describe, expect, it } from 'vitest';
import { statText, type StatInput } from './statText';

const base: StatInput = { shown: 170, total: 170, rate: 0.7, live: true, paused: false, held: 0, following: true, unseen: 0, dropped: 0 };
const text = (over: Partial<StatInput> = {}) => statText({ ...base, ...over });

describe('statText', () => {
  it('says how many lines, how fast and that it follows', () => {
    expect(text()).toBe('170 lines · 0.7 lines/s · Following');
  });

  it('counts one line in the singular and the thousands with a comma', () => {
    expect(text({ shown: 1, total: 1 })).toBe('1 line · 0.7 lines/s · Following');
    expect(text({ shown: 12_345, total: 12_345 })).toBe('12,345 lines · 0.7 lines/s · Following');
  });

  it('says how many of the lines a filter shows', () => {
    expect(text({ shown: 27, total: 170 })).toBe('27 of 170 lines · 0.7 lines/s · Following');
  });

  it('writes the rate to a tenth, and none when the stream is not live', () => {
    expect(text({ rate: 1234.567 })).toBe('170 lines · 1,234.6 lines/s · Following');
    expect(text({ live: false })).toBe('170 lines');
  });

  it('says it is scrolled back, with the new lines that came meanwhile', () => {
    expect(text({ following: false })).toBe('170 lines · 0.7 lines/s · Scrolled back');
    expect(text({ following: false, unseen: 1 })).toBe('170 lines · 0.7 lines/s · Scrolled back, 1 new line');
    expect(text({ following: false, unseen: 1200 })).toBe('170 lines · 0.7 lines/s · Scrolled back, 1,200 new lines');
  });

  it('says it is paused, with the lines held meanwhile; pause wins over following', () => {
    expect(text({ paused: true })).toBe('170 lines · 0.7 lines/s · Paused');
    expect(text({ paused: true, held: 45 })).toBe('170 lines · 0.7 lines/s · Paused, 45 new lines waiting');
    expect(text({ paused: true, following: false, held: 1 })).toBe('170 lines · 0.7 lines/s · Paused, 1 new line waiting');
  });

  it('says what was dropped', () => {
    expect(text({ dropped: 1 })).toBe('170 lines · 0.7 lines/s · Following · 1 older line dropped');
    expect(text({ dropped: 12_000, live: false, following: false })).toBe('170 lines · Scrolled back · 12,000 older lines dropped');
  });

  it('says nothing of the position of a log that is over: it has no end to follow', () => {
    expect(text({ live: false, following: true })).toBe('170 lines');
  });
});
