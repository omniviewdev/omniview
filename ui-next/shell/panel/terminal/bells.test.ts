import { describe, expect, it, vi } from 'vitest';
import { BELL_WORDS, createBellMarks } from './bells';

// The bells of terminals that are not shown (#697 step 3): a program rang the bell in a session whose body is off screen, and its tab says so until the session is shown. The mark is a fact of the registry, read by the tab strip as
// an external store: the same answer until it changes, a notification only for a change, nothing held for a session that closed.

describe('the bell marks of the tabs', () => {
  it('has none until a bell rings, and the words of one when it does', () => {
    const marks = createBellMarks();
    expect(marks.of('a')).toBeUndefined();
    marks.ring('a');
    expect(marks.of('a')).toEqual({ label: BELL_WORDS });
    expect(marks.of('b')).toBeUndefined();
  });

  it('says the same object while the mark stands, and tells the listeners once for a mark and once for its end, never for what changed nothing', () => {
    const marks = createBellMarks();
    const heard = vi.fn();
    marks.subscribe(heard);
    marks.ring('a');
    const first = marks.of('a');
    marks.ring('a');
    marks.ring('a');
    expect(marks.of('a')).toBe(first);
    expect(heard).toHaveBeenCalledTimes(1);
    marks.clear('a');
    expect(marks.of('a')).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
    marks.clear('a');
    marks.clear('never');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('stops telling a listener that left, and holds nothing for a session after it is cleared', () => {
    const marks = createBellMarks();
    const heard = vi.fn();
    const stop = marks.subscribe(heard);
    stop();
    marks.ring('a');
    expect(heard).not.toHaveBeenCalled();
    marks.clear('a');
    expect(marks.size()).toBe(0);
  });
});
