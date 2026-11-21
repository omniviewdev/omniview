import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAVE_MS, createHolds } from './holds';

// What the pointer and the focus tell the model about the stack (ch16 S78, the mock's `setPaused`, `pointerover`, `pointerout`, `focusin`, `focusout`): the clocks wait while the pointer or the focus is in the
// stack, and the stack pauses as ONE, so a toast under the pointer never moves because another closed. The pointer is let go a moment after it left (the gap between two toasts is not a place to leave to) and
// only if no toast is under it then: a browser tells nobody when the element under a pointer is removed, so after every draw the hold is asked again whether its cause still stands.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const make = (over = false) => {
  const calls: Array<readonly [string, boolean]> = [];
  const under = { over };
  const store = {
    hold: (reason: 'pointer' | 'focus' | 'modal' | 'center', on: boolean) => {
      calls.push([reason, on]);
      return true;
    },
  };
  const holds = createHolds(store);
  const asks = () => under.over;
  return {
    calls,
    under,
    holds,
    /** The pointer left a toast; whether one is under it a moment later is `under.over`. */
    out: () => {
      holds.pointerOut(asks);
    },
    /** A draw that left `toasts` toasts, the one with the focus (or not). */
    settle: (toasts: number, focus = false) => {
      holds.settle({ toasts, focus }, asks);
    },
  };
};

describe('the pointer', () => {
  it('holds the clocks at once when it is over a toast, and says so once however often it moves over the stack', () => {
    const { calls, holds } = make();
    holds.pointerOver();
    holds.pointerOver();
    holds.pointerOver();
    expect(calls).toEqual([['pointer', true]]);
  });

  it('lets go a moment after it left for something that is not a toast', () => {
    const { calls, holds, out } = make(false);
    holds.pointerOver();
    out();
    vi.advanceTimersByTime(LEAVE_MS - 1);
    expect(calls).toEqual([['pointer', true]]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([['pointer', true], ['pointer', false]]);
  });

  it('keeps holding when a toast is under it again when the moment is over: it crossed the gap to another toast', () => {
    const { calls, under, holds, out } = make(false);
    holds.pointerOver();
    out();
    under.over = true;
    holds.pointerOver();
    vi.advanceTimersByTime(60_000);
    expect(calls).toEqual([['pointer', true]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks again at the end of the moment, whatever it was told before: the answer of that moment is the one that counts', () => {
    const { calls, under, holds, out } = make(true);
    holds.pointerOver();
    out();
    vi.advanceTimersByTime(LEAVE_MS);
    expect(calls).toEqual([['pointer', true]]);
    under.over = false;
    out();
    vi.advanceTimersByTime(LEAVE_MS);
    expect(calls).toEqual([['pointer', true], ['pointer', false]]);
  });

  it('says nothing for a pointer that was never over a toast', () => {
    const { calls, out } = make();
    out();
    vi.advanceTimersByTime(LEAVE_MS * 3);
    expect(calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the focus', () => {
  it('holds while it is in the stack and lets go when it leaves, at once', () => {
    const { calls, holds } = make();
    holds.focusIn();
    holds.focusIn();
    holds.focusOut();
    holds.focusOut();
    expect(calls).toEqual([['focus', true], ['focus', false]]);
  });
});

describe('settling after a draw: a hold whose cause is gone is let go', () => {
  it('asks the pointer again a moment after a draw that left toasts, and lets it go when none is under it (the toast it was over was dismissed: the browser says nothing)', () => {
    const { calls, holds, settle } = make(false);
    holds.pointerOver();
    settle(2);
    expect(calls).toEqual([['pointer', true]]);
    vi.advanceTimersByTime(LEAVE_MS);
    expect(calls).toEqual([['pointer', true], ['pointer', false]]);
  });

  it('keeps the pointer when a toast is still under it after the draw', () => {
    const { calls, holds, settle } = make(true);
    holds.pointerOver();
    settle(2);
    vi.advanceTimersByTime(LEAVE_MS * 5);
    expect(calls).toEqual([['pointer', true]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets go of the focus at once when no toast has it any more (the focused toast went under the summary or was dismissed)', () => {
    const { calls, holds, settle } = make();
    holds.focusIn();
    settle(2, false);
    expect(calls).toEqual([['focus', true], ['focus', false]]);
  });

  it('keeps the focus while a toast has it, and starts no timer when the pointer was never held', () => {
    const { calls, holds, settle } = make();
    holds.focusIn();
    settle(3, true);
    expect(calls).toEqual([['focus', true]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets go of everything when the stack is empty, and leaves no timer: nothing is left to hold', () => {
    const { calls, holds, out, settle } = make(true);
    holds.pointerOver();
    out();
    holds.focusIn();
    expect(vi.getTimerCount()).toBe(1);
    settle(0, true);
    expect(calls).toEqual([['pointer', true], ['focus', true], ['pointer', false], ['focus', false]]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(LEAVE_MS * 3);
    expect(calls).toHaveLength(4);
  });
});

describe('disposing', () => {
  it('lets go of what it holds and drops its timer, so a window that goes leaves the clocks running and no timer behind', () => {
    const { calls, holds, out } = make(true);
    holds.pointerOver();
    out();
    holds.focusIn();
    holds.dispose();
    expect(calls).toEqual([['pointer', true], ['focus', true], ['pointer', false], ['focus', false]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is safe to call twice and says nothing when it held nothing', () => {
    const { calls, holds } = make();
    holds.dispose();
    holds.dispose();
    expect(calls).toEqual([]);
  });
});
