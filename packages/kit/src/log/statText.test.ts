// The words of the status strip (the mock's `statText`, S120): how many lines, how fast, where the list is (following, scrolled back, paused), and what was
// dropped. A pure function of numbers, so the strip's text is one thing the tests pin.
import { describe, expect, it } from 'vitest';
import { droppedNote, statText, type StatInput } from './statText';

const base: StatInput = { shown: 170, total: 170, rate: 0.7, live: true, paused: false, held: 0, following: true, unseen: 0, dropped: 0, unread: 0, capacity: 100_000 };
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

// L1: one sentence in the mock's words ("N older lines dropped"), one total; what it is made of is said in the note that goes with it.
describe('what was dropped, in one number and its note', () => {
  it('says one total whoever dropped the lines: the view that evicted them and the feed that never gave them', () => {
    expect(text({ dropped: 100_450, unread: 30_200 })).toBe('170 lines · 0.7 lines/s · Following · 100,450 older lines dropped');
    expect(text({ dropped: 30_200, unread: 30_200, live: false })).toBe('170 lines · 30,200 older lines dropped');
  });

  it('has no note while nothing was dropped', () => {
    expect(droppedNote({ dropped: 0, unread: 0, capacity: 100_000 })).toBeUndefined();
  });

  it('says the view keeps the latest lines when it evicted all of them', () => {
    expect(droppedNote({ dropped: 70_250, unread: 0, capacity: 100_000 })).toBe('70,250 older lines were pushed out of the view, which keeps the latest 100,000.');
  });

  it('says the lines the feed dropped never reached the view, apart from the ones the view evicted', () => {
    expect(droppedNote({ dropped: 100_450, unread: 30_200, capacity: 100_000 })).toBe(
      '30,200 lines never reached the view: the feed held too many while the view was not reading. 70,250 older lines were pushed out of the view, which keeps the latest 100,000.',
    );
    expect(droppedNote({ dropped: 30_200, unread: 30_200, capacity: 100_000 })).toBe('30,200 lines never reached the view: the feed held too many while the view was not reading.');
    expect(droppedNote({ dropped: 2, unread: 1, capacity: 100 })).toBe('1 line never reached the view: the feed held too many while the view was not reading. 1 older line was pushed out of the view, which keeps the latest 100.');
  });
});
