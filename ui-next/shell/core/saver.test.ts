import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaver } from './saver';

// The generic saver both models write through (docs/ui-next/optimisations.md HSH-25, HLT-36, MNR-K2): one write per burst of changes, the last value 400 ms after the last change, and a flush when
// the window closes. What is under test here is what it does when the place it writes to refuses: the document is recorded as saved only once it was, and a failed one stays pending.

type Doc = { readonly value: number };

/** A store that is a number: `set` changes it and tells the listener, as a model's store does. */
function counter(initial = 0) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    store: {
      getSnapshot: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    set: (next: number) => {
      value = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

const serialise = (value: number): Doc => ({ value });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the saver', () => {
  it('writes once per burst, 400 ms after the last change, and not at all for a change that comes back to what was saved', () => {
    const { store, set } = counter();
    const writes: Doc[] = [];
    createSaver({ store, serialise, write: (doc) => writes.push(doc) });
    set(1);
    vi.advanceTimersByTime(300);
    set(2);
    vi.advanceTimersByTime(399);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual([{ value: 2 }]);
    set(3);
    set(2);
    vi.advanceTimersByTime(400);
    expect(writes).toEqual([{ value: 2 }]);
  });

  it('flushes what is pending at once, and does nothing when nothing is', () => {
    const { store, set } = counter();
    const writes: Doc[] = [];
    const saver = createSaver({ store, serialise, write: (doc) => writes.push(doc) });
    saver.flush();
    expect(writes).toEqual([]);
    set(5);
    saver.flush();
    expect(writes).toEqual([{ value: 5 }]);
    saver.flush();
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual([{ value: 5 }]);
  });

  it('dispose drops what is pending and stops listening', () => {
    const { store, set } = counter();
    const writes: Doc[] = [];
    const saver = createSaver({ store, serialise, write: (doc) => writes.push(doc) });
    set(1);
    saver.dispose();
    saver.flush();
    set(2);
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual([]);
  });
});

describe('a write that publishes to the store it saves (CodeRabbit, saver.ts:40)', () => {
  it('leaves that change owed, so a flush before its timer writes it', () => {
    const { store, set } = counter();
    const writes: Doc[] = [];
    const saver = createSaver({
      store,
      serialise,
      write: (doc) => {
        writes.push(doc);
        if (doc.value === 1) {
          set(2);
        }
      },
    });
    set(1);
    vi.advanceTimersByTime(400);
    expect(writes).toEqual([{ value: 1 }]);
    saver.flush();
    expect(writes).toEqual([{ value: 1 }, { value: 2 }]);
  });
});

describe('a write that fails', () => {
  /** A sink that throws while `failing` is true. */
  function sink() {
    const state = { failing: true, attempts: [] as Doc[], saved: [] as Doc[] };
    return {
      state,
      write: (doc: Doc) => {
        state.attempts.push(doc);
        if (state.failing) {
          throw new Error('the storage is full');
        }

        state.saved.push(doc);
      },
    };
  }

  it('is not recorded as saved: the same document is written again by a flush, which is how the last state is not lost when the window closes', () => {
    const { store, set } = counter();
    const target = sink();
    const saver = createSaver({ store, serialise, write: target.write });
    set(1);
    expect(() => vi.advanceTimersByTime(400)).toThrow('the storage is full');
    expect(target.state.attempts).toEqual([{ value: 1 }]);
    // The timer has run, so a saver that only flushes what a timer holds would do nothing here: the document is still owed.
    target.state.failing = false;
    saver.flush();
    expect(target.state.saved).toEqual([{ value: 1 }]);
    // Saved now: nothing is owed any more.
    saver.flush();
    vi.advanceTimersByTime(1000);
    expect(target.state.saved).toEqual([{ value: 1 }]);
  });

  it('is written again after a later change that serialises to the same document (a saver that recorded the failed text as saved would skip it)', () => {
    const { store, set } = counter();
    const target = sink();
    createSaver({ store, serialise, write: target.write });
    set(1);
    expect(() => vi.advanceTimersByTime(400)).toThrow();
    target.state.failing = false;
    // Another change, back to the very document that failed: the place has never had it.
    set(2);
    set(1);
    vi.advanceTimersByTime(400);
    expect(target.state.saved).toEqual([{ value: 1 }]);
  });

  it('lets the caller of flush see the failure, and keeps the document owed', () => {
    const { store, set } = counter();
    const target = sink();
    const saver = createSaver({ store, serialise, write: target.write });
    set(7);
    expect(() => {
      saver.flush();
    }).toThrow('the storage is full');
    expect(() => {
      saver.flush();
    }).toThrow('the storage is full');
    expect(target.state.attempts).toEqual([{ value: 7 }, { value: 7 }]);
    target.state.failing = false;
    saver.flush();
    expect(target.state.saved).toEqual([{ value: 7 }]);
  });

  it('does not retry by itself: a place that stays full is asked again at the next change or flush, never in a loop', () => {
    const { store, set } = counter();
    const target = sink();
    createSaver({ store, serialise, write: target.write });
    set(1);
    expect(() => vi.advanceTimersByTime(400)).toThrow();
    vi.advanceTimersByTime(60_000);
    expect(target.state.attempts).toHaveLength(1);
  });

  it('is dropped by dispose, as anything pending is', () => {
    const { store, set } = counter();
    const target = sink();
    const saver = createSaver({ store, serialise, write: target.write });
    set(1);
    expect(() => vi.advanceTimersByTime(400)).toThrow();
    saver.dispose();
    target.state.failing = false;
    saver.flush();
    expect(target.state.saved).toEqual([]);
  });
});
