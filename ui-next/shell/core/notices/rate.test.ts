import { describe, expect, it } from 'vitest';
import { createRate } from './rate';
import { START } from './testing';

// A plugin cannot flood the user (ch16 S82: more than twenty records a minute from one plugin fold into one row; the lead's brief: bound per source per second). Counting is by one-second
// slots of a minute, so a hit costs the same however many came before it; EVERY hit counts, the refused ones too, so a source that keeps flooding stays folded until it has been quiet.

const second = 1000;

describe('createRate', () => {
  it('lets a source post its budget in a second, and refuses the rest', () => {
    const rate = createRate({ perSecond: 5, perMinute: 20 });
    const answers = Array.from({ length: 8 }, () => rate.hit('cloud', START));
    expect(answers).toEqual([false, false, false, false, false, true, true, true]);
  });

  it('starts a new budget with the next second, while the minute keeps counting', () => {
    const rate = createRate({ perSecond: 5, perMinute: 20 });
    for (let at = 0; at < 4; at += 1) {
      for (let index = 0; index < 5; index += 1) {
        expect(rate.hit('cloud', START + (at * second))).toBe(false);
      }
    }

    // Twenty in four seconds: the next is the twenty-first of the minute.
    expect(rate.hit('cloud', START + (4 * second))).toBe(true);
  });

  it('stays folded while it floods, and recovers after a quiet minute', () => {
    const rate = createRate({ perSecond: 5, perMinute: 20 });
    for (let at = 0; at < 30; at += 1) {
      rate.hit('cloud', START + (at * second));
    }

    expect(rate.hit('cloud', START + (31 * second))).toBe(true);
    expect(rate.hit('cloud', START + (31 * second) + 61_000)).toBe(false);
  });

  it('counts the refused hits too: a source that keeps flooding does not slip one through every few seconds', () => {
    const rate = createRate({ perSecond: 1, perMinute: 3 });
    const answers = Array.from({ length: 12 }, (_, index) => rate.hit('cloud', START + (index * 4 * second)));
    // 0 s, 4 s, 8 s are within budget (three a minute); then each next hit finds the minute full.
    expect(answers.slice(0, 3)).toEqual([false, false, false]);
    expect(answers.slice(3)).toEqual(Array.from({ length: 9 }, () => true));
  });

  it('keeps sources apart', () => {
    const rate = createRate({ perSecond: 2, perMinute: 20 });
    expect([rate.hit('cloud', START), rate.hit('cloud', START), rate.hit('cloud', START)]).toEqual([false, false, true]);
    expect(rate.hit('stack', START)).toBe(false);
  });

  it('forgets a source that left', () => {
    const rate = createRate({ perSecond: 1, perMinute: 20 });
    rate.hit('cloud', START);
    expect(rate.hit('cloud', START)).toBe(true);
    rate.forget('cloud');
    expect(rate.hit('cloud', START)).toBe(false);
    expect(rate.size()).toBe(1);
    rate.forget('cloud');
    expect(rate.size()).toBe(0);
  });

  it('does not count a slot that a minute ago filled: the same slot twice', () => {
    const rate = createRate({ perSecond: 5, perMinute: 20 });
    for (let index = 0; index < 5; index += 1) {
      rate.hit('cloud', START);
    }

    // 60 s later the slot is the same one: its old count is not this second's.
    for (let index = 0; index < 5; index += 1) {
      expect(rate.hit('cloud', START + (60 * second))).toBe(false);
    }
  });

  it('answers ten thousand hits in one tick at the cost of ten thousand counts, and only the budget passes', () => {
    const rate = createRate({ perSecond: 5, perMinute: 20 });
    const started = performance.now();
    let passed = 0;
    for (let index = 0; index < 10_000; index += 1) {
      if (!rate.hit('cloud', START)) {
        passed += 1;
      }
    }

    expect(passed).toBe(5);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('uses the limits of the model by default: a few a second, twenty a minute (S82)', () => {
    const rate = createRate();
    const passed = Array.from({ length: 100 }, () => rate.hit('cloud', START)).filter((over) => !over).length;
    expect(passed).toBeGreaterThanOrEqual(1);
    expect(passed).toBeLessThanOrEqual(20);
  });
});
