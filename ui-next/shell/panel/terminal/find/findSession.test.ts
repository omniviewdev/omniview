import { describe, expect, it } from 'vitest';
import type { FindState } from '../engine';
import { INITIAL_FIND, isValid } from './findModel';
import { createFindSession, type FindSession } from './findSession';
import { fakeFinder, fakeFindScreen, settled, type FakeFinder, type FakeFindScreen, type FakeFindScreenOptions } from './testing';

// The behaviour behind the find bar, with no DOM: when the screen is asked for its finder (the first time the bar opens, and not before: the emulator's search is a lazy chunk), what is searched for as the person types and
// flips a switch, what the bar says of the engine's answer, what closing gives back, and what a bar that is opened again keeps. A fake screen and a fake finder (`testing.ts`); a screen that HOLDS its answers puts the finder's
// arrival where a test wants it, with no timer.

type Rig = {
  readonly session: FindSession;
  readonly screen: FakeFindScreen;
  readonly finder: FakeFinder;
  readonly warnings: ReadonlyArray<readonly [string, unknown]>;
  /** How many times the session told its subscribers, and the keyboard's count at each telling. */
  readonly told: number[];
};

function rig(config: FakeFindScreenOptions = {}): Rig {
  const finder = fakeFinder();
  const screen = fakeFindScreen({ finder, ...config });
  const warnings: Array<readonly [string, unknown]> = [];
  const session = createFindSession({
    warn: (message, error) => {
      warnings.push([message, error]);
    },
  });
  const told: number[] = [];
  session.subscribe(() => {
    told.push(screen.focuses());
  });
  session.bind(screen);
  return { session, screen, finder, warnings, told };
}

const state = (index: number, count: number, capped = false): FindState => ({ index, count, capped });
const OFF = { caseSensitive: false, regex: false, wholeWord: false };

describe('a session that was never opened', () => {
  it('is closed, holds no query, has every switch off and has heard nothing', () => {
    const { session } = rig();
    expect(session.getSnapshot()).toEqual({ isOpen: false, input: INITIAL_FIND, valid: true, result: undefined, focusRequests: 0, unavailable: false });
  });

  it('asks the screen for nothing until the bar is opened: binding, typing, flipping a switch and stepping a closed bar load none of the emulator\'s search', () => {
    const { session, screen, finder } = rig();
    session.setQuery('a');
    session.toggle('regex');
    expect(session.step('next')).toBe(false);
    expect(session.step('previous')).toBe(false);
    expect(screen.asks()).toBe(0);
    expect(finder.calls).toEqual([]);
    expect(finder.clears()).toBe(0);
    expect(finder.listeners()).toBe(0);
  });

  it('keeps what it is given while it is closed, so that the bar opens on it, and does not touch the engine for it', () => {
    const { session } = rig();
    session.setQuery('a(');
    session.toggle('regex');
    expect(session.getSnapshot().input).toEqual({ query: 'a(', caseSensitive: false, regex: true, wholeWord: false });
    expect(session.getSnapshot().valid).toBe(false);
  });

  it('gives the same snapshot object until something changes: a store that changes its object without a change is a render for nothing', () => {
    const { session } = rig();
    expect(session.getSnapshot()).toBe(session.getSnapshot());
    const before = session.getSnapshot();
    session.step('next');
    session.close();
    expect(session.getSnapshot()).toBe(before);
  });

  it('cannot be opened with no screen: it stays closed and says nothing', () => {
    const session = createFindSession();
    const heard: number[] = [];
    session.subscribe(() => {
      heard.push(1);
    });
    session.open();
    expect(session.getSnapshot().isOpen).toBe(false);
    expect(session.getSnapshot().focusRequests).toBe(0);
    expect(heard).toEqual([]);
  });
});

describe('opening the bar', () => {
  it('opens it, asks the screen for its finder, asks for the keyboard for the field, and tells its subscribers', async () => {
    const { session, screen, told } = rig();
    session.open();
    await settled();
    expect(session.getSnapshot()).toMatchObject({ isOpen: true, focusRequests: 1, result: undefined });
    expect(screen.asks()).toBe(1);
    expect(told.length).toBeGreaterThan(0);
  });

  it('listens to the finder while it is open', async () => {
    const { session, finder } = rig();
    session.open();
    await settled();
    expect(finder.listeners()).toBe(1);
  });

  it('asks for the finder on the FIRST open only: closing and opening again, and the chord pressed with the bar open, ask no more', async () => {
    const { session, screen } = rig();
    session.open();
    await settled();
    session.close();
    session.open();
    session.open();
    await settled();
    session.close();
    session.open();
    await settled();
    expect(screen.asks()).toBe(1);
  });

  it('asks once while its answer is awaited, however many times the bar is opened and closed meanwhile', () => {
    const { session, screen } = rig({ held: true });
    session.open();
    session.close();
    session.open();
    session.open();
    expect(screen.asks()).toBe(1);
    expect(screen.waiting()).toBe(1);
  });

  it('asks again at the next thing the person does when the screen had no finder to give yet (its emulator is not made): typing, stepping and opening are each a reason', async () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    expect(screen.asks()).toBe(1);
    screen.answer(undefined);
    await settled();
    expect(finder.listeners()).toBe(0);
    session.setQuery('a');
    expect(screen.asks()).toBe(2);
    screen.answer(undefined);
    await settled();
    expect(session.step('next')).toBe(true);
    expect(screen.asks()).toBe(3);
    screen.answer(finder);
    await settled();
    expect(finder.calls).toEqual([{ direction: 'next', query: 'a', options: OFF }]);
    expect(finder.listeners()).toBe(1);
    session.setQuery('ab');
    expect(screen.asks()).toBe(3);
  });

  it('does not take a finder from a screen that answers after the bar was bound to nothing', async () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    session.bind(undefined);
    screen.answer(finder);
    await settled();
    expect(finder.listeners()).toBe(0);
    expect(session.getSnapshot().isOpen).toBe(false);
  });
});

describe('typing and flipping a switch', () => {
  async function open(config: FakeFindScreenOptions = {}): Promise<Rig> {
    const made = rig(config);
    made.session.open();
    await settled();
    return made;
  }

  it('looks for the text as it is typed: one step of the finder forward for each change, with the switches as they are', async () => {
    const { session, finder } = await open();
    session.setQuery('a');
    session.setQuery('ab');
    expect(finder.calls).toEqual([
      { direction: 'next', query: 'a', options: OFF },
      { direction: 'next', query: 'ab', options: OFF },
    ]);
  });

  it('looks again, for the same text, when a switch is flipped: the engine is given the three switches as they stand', async () => {
    const { session, finder } = await open();
    session.setQuery('ab');
    session.toggle('caseSensitive');
    session.toggle('wholeWord');
    session.toggle('regex');
    expect(finder.calls.map((call) => [call.query, call.options])).toEqual([
      ['ab', OFF],
      ['ab', { caseSensitive: true, regex: false, wholeWord: false }],
      ['ab', { caseSensitive: true, regex: false, wholeWord: true }],
      ['ab', { caseSensitive: true, regex: true, wholeWord: true }],
    ]);
    session.toggle('caseSensitive');
    expect(finder.calls.at(-1)?.options).toEqual({ caseSensitive: false, regex: true, wholeWord: true });
  });

  it('clears the highlights when the text is emptied, and does not look for nothing', async () => {
    const { session, finder } = await open();
    session.setQuery('a');
    session.setQuery('');
    expect(finder.calls).toHaveLength(1);
    expect(finder.clears()).toBe(1);
    session.setQuery('');
    expect(finder.clears()).toBe(1);
  });

  it('leaves the finder alone when a switch is flipped with nothing typed', async () => {
    const { session, finder } = await open();
    session.toggle('caseSensitive');
    session.toggle('regex');
    expect(finder.calls).toEqual([]);
    expect(finder.clears()).toBe(0);
  });

  it('forgets what the engine said for the text before: the count of another query is never shown beside this one', async () => {
    const { session, finder } = await open();
    session.setQuery('a');
    finder.tell(state(0, 3));
    expect(session.getSnapshot().result).toEqual(state(0, 3));
    session.setQuery('ab');
    expect(session.getSnapshot().result).toBeUndefined();
    finder.tell(state(1, 2));
    session.toggle('caseSensitive');
    expect(session.getSnapshot().result).toBeUndefined();
  });

  it('keeps what the engine says while the bar is open, and tells its subscribers', async () => {
    const { session, finder, told } = await open();
    session.setQuery('a');
    const heard = told.length;
    finder.tell(state(2, 12));
    expect(session.getSnapshot().result).toEqual(state(2, 12));
    expect(told.length).toBe(heard + 1);
    finder.tell(state(-1, 0));
    expect(session.getSnapshot().result).toEqual(state(-1, 0));
  });

  it('never gives the engine a pattern that does not parse: the highlights of the search before it are cleared, once, and the bar says it is invalid', async () => {
    const { session, finder } = await open();
    session.toggle('regex');
    session.setQuery('a');
    session.setQuery('a(');
    expect(session.getSnapshot().valid).toBe(false);
    expect(finder.calls).toHaveLength(1);
    expect(finder.clears()).toBe(1);
    session.setQuery('a(b');
    expect(finder.calls).toHaveLength(1);
    expect(finder.clears()).toBe(1);
    session.setQuery('a(b)');
    expect(session.getSnapshot().valid).toBe(true);
    expect(finder.calls.at(-1)).toEqual({ direction: 'next', query: 'a(b)', options: { caseSensitive: false, regex: true, wholeWord: false } });
    for (const call of finder.calls) {
      expect(isValid({ ...call.options, query: call.query })).toBe(true);
    }
  });

  it('does not give the engine a pattern when the regular expression switch is turned on over a text that does not parse as one, and gives it the text again when it is turned off', async () => {
    const { session, finder } = await open();
    session.setQuery('a(');
    expect(finder.calls).toHaveLength(1);
    session.toggle('regex');
    expect(finder.calls).toHaveLength(1);
    expect(finder.clears()).toBe(1);
    expect(session.getSnapshot().valid).toBe(false);
    session.toggle('regex');
    expect(session.getSnapshot().valid).toBe(true);
    expect(finder.calls).toHaveLength(2);
    expect(finder.calls.at(-1)).toEqual({ direction: 'next', query: 'a(', options: OFF });
  });

  it('searches, once the finder arrives, for what is in the field by then: typing before it came is not lost, and is not searched twice', async () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    session.setQuery('a');
    session.setQuery('ab');
    expect(finder.calls).toEqual([]);
    screen.answer(finder);
    await settled();
    expect(finder.calls).toEqual([{ direction: 'next', query: 'ab', options: OFF }]);
    expect(finder.listeners()).toBe(1);
  });

  it('searches nothing when the finder arrives and there is nothing to look for', async () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    screen.answer(finder);
    await settled();
    expect(finder.calls).toEqual([]);
    expect(finder.listeners()).toBe(1);
  });

  it('keeps a finder that arrives after the bar was closed, listens to nothing and searches nothing, and has it ready for the next opening without asking again', async () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    session.setQuery('a');
    session.close();
    screen.answer(finder);
    await settled();
    expect(finder.calls).toEqual([]);
    expect(finder.listeners()).toBe(0);
    session.open();
    expect(screen.asks()).toBe(1);
    expect(finder.listeners()).toBe(1);
    expect(finder.calls).toEqual([{ direction: 'next', query: 'a', options: OFF }]);
  });
});

describe('stepping', () => {
  async function open(): Promise<Rig> {
    const made = rig();
    made.session.open();
    await settled();
    return made;
  }

  it('is the bar\'s while it is open and says so, and is not the bar\'s while it is closed: the key then goes to the terminal', async () => {
    const { session } = await open();
    expect(session.step('next')).toBe(true);
    expect(session.step('previous')).toBe(true);
    session.close();
    expect(session.step('next')).toBe(false);
    expect(session.step('previous')).toBe(false);
  });

  it('steps the finder forward or back for the text and the switches as they stand', async () => {
    const { session, finder } = await open();
    session.setQuery('foo');
    session.toggle('caseSensitive');
    session.step('next');
    session.step('previous');
    session.step('next');
    expect(finder.calls.slice(2)).toEqual([
      { direction: 'next', query: 'foo', options: { caseSensitive: true, regex: false, wholeWord: false } },
      { direction: 'previous', query: 'foo', options: { caseSensitive: true, regex: false, wholeWord: false } },
      { direction: 'next', query: 'foo', options: { caseSensitive: true, regex: false, wholeWord: false } },
    ]);
  });

  it('takes the key and steps nothing when there is nothing to look for: an empty field, or a pattern that does not parse', async () => {
    const { session, finder } = await open();
    expect(session.step('next')).toBe(true);
    session.toggle('regex');
    session.setQuery('(');
    expect(session.step('previous')).toBe(true);
    expect(finder.calls).toEqual([]);
  });

  it('does not tell its subscribers: the engine says where the find stands', async () => {
    const { session, told } = await open();
    session.setQuery('a');
    const heard = told.length;
    session.step('next');
    expect(told.length).toBe(heard);
  });

  it('takes the key before the finder has arrived, and looks when it does', async () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    session.setQuery('a');
    expect(session.step('previous')).toBe(true);
    expect(finder.calls).toEqual([]);
    screen.answer(finder);
    await settled();
    expect(finder.calls).toEqual([{ direction: 'next', query: 'a', options: OFF }]);
  });
});

describe('closing the bar', () => {
  it('clears the highlights, lets go of the finder, gives the keyboard back to the screen, and forgets the count but not the text', async () => {
    const { session, screen, finder } = rig();
    session.open();
    await settled();
    session.setQuery('foo');
    session.toggle('wholeWord');
    finder.tell(state(0, 4));
    session.close();
    expect(finder.clears()).toBe(1);
    expect(finder.listeners()).toBe(0);
    expect(screen.focuses()).toBe(1);
    expect(session.getSnapshot()).toMatchObject({ isOpen: false, result: undefined, input: { query: 'foo', wholeWord: true } });
  });

  it('gives the keyboard back before it tells its subscribers, while the field is still in the document', async () => {
    const { session, told } = rig();
    session.open();
    await settled();
    const before = told.length;
    session.close();
    expect(told).toHaveLength(before + 1);
    expect(told.at(-1)).toBe(1);
  });

  it('clears the highlights of a search that was never typed too: closing is the one way the engine is told the find is over', async () => {
    const { session, finder } = rig();
    session.open();
    await settled();
    session.close();
    expect(finder.clears()).toBe(1);
  });

  it('does nothing when it is not open: it neither clears nor takes the keyboard nor tells anyone', async () => {
    const { session, screen, finder, told } = rig();
    session.close();
    session.open();
    await settled();
    session.close();
    const heard = told.length;
    const clears = finder.clears();
    const focuses = screen.focuses();
    session.close();
    expect(told).toHaveLength(heard);
    expect(finder.clears()).toBe(clears);
    expect(screen.focuses()).toBe(focuses);
  });

  it('ignores what the finder says after the bar was closed', async () => {
    const { session, finder } = rig();
    session.open();
    await settled();
    session.close();
    finder.tell(state(1, 2));
    expect(session.getSnapshot().result).toBeUndefined();
  });

  it('has nothing to clear when the finder never arrived, and gives the keyboard back all the same', () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    session.close();
    expect(finder.clears()).toBe(0);
    expect(screen.focuses()).toBe(1);
  });
});

describe('opening the bar again', () => {
  it('keeps the text and the switches, looks again for them so that the highlights and the count come back, and has no count until the engine says it', async () => {
    const { session, finder } = rig();
    session.open();
    await settled();
    session.setQuery('foo');
    session.toggle('caseSensitive');
    finder.tell(state(0, 2));
    session.close();
    const calls = finder.calls.length;
    session.open();
    expect(session.getSnapshot()).toMatchObject({ isOpen: true, result: undefined, input: { query: 'foo', caseSensitive: true } });
    expect(finder.calls).toHaveLength(calls + 1);
    expect(finder.calls.at(-1)).toEqual({ direction: 'next', query: 'foo', options: { caseSensitive: true, regex: false, wholeWord: false } });
    expect(finder.listeners()).toBe(1);
    finder.tell(state(0, 2));
    expect(session.getSnapshot().result).toEqual(state(0, 2));
  });

  it('looks for nothing when there is nothing typed, or what was typed does not parse', async () => {
    const { session, finder } = rig();
    session.open();
    await settled();
    session.close();
    session.open();
    expect(finder.calls).toEqual([]);
    session.toggle('regex');
    session.setQuery('(');
    session.close();
    session.open();
    expect(finder.calls).toEqual([]);
  });

  it('asks for the keyboard for the field every time: also when the bar is already open (the chord pressed again), which looks for nothing again and listens once', async () => {
    const { session, finder } = rig();
    session.open();
    await settled();
    expect(session.getSnapshot().focusRequests).toBe(1);
    session.setQuery('a');
    session.open();
    session.open();
    expect(session.getSnapshot().focusRequests).toBe(3);
    expect(finder.calls).toHaveLength(1);
    expect(finder.listeners()).toBe(1);
    session.close();
    session.open();
    expect(session.getSnapshot().focusRequests).toBe(4);
  });
});

describe('a finder that cannot be had', () => {
  /** A failed load, as a bar that was just opened meets it: the screen's answer is a rejection, and the bar is open on an empty field. */
  async function failed(): Promise<Rig> {
    const made = rig({ held: true });
    made.session.open();
    made.screen.fail(new Error('the chunk did not load'));
    await settled();
    return made;
  }

  it('logs once, says so in what the bar holds, and keeps the bar: it is there, and finds nothing', async () => {
    const { session, finder, warnings } = await failed();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[0]).toMatch(/find/i);
    expect((warnings[0]?.[1] as Error).message).toBe('the chunk did not load');
    expect(session.getSnapshot()).toMatchObject({ isOpen: true, unavailable: true, result: undefined });
    expect(finder.calls).toEqual([]);
  });

  it('tells its subscribers that the search is unavailable: the lane says it', async () => {
    const { session, screen } = rig({ held: true });
    session.open();
    const heard: boolean[] = [];
    session.subscribe(() => {
      heard.push(session.getSnapshot().unavailable);
    });
    screen.fail(new Error('no chunk'));
    await settled();
    expect(heard).toEqual([true]);
  });

  // Every request is a reason to ask again: a failure is not for ever (the chunk may load the next time), and the words are there until a request gets the finder.
  it.each<[string, (session: FindSession) => void]>([
    ['typing', (session) => {
      session.setQuery('a');
    }],
    ['a switch', (session) => {
      session.toggle('regex');
    }],
    ['Enter or F3', (session) => {
      session.step('next');
    }],
    ['the bar closed and opened again', (session) => {
      session.close();
      session.open();
    }],
    ['the chord pressed with the bar open', (session) => {
      session.open();
    }],
    ['the screen saying that its emulator is there', (session) => {
      session.screenReady();
    }],
  ])('asks the screen again at the next request, which is %s', async (_what, request) => {
    const { session, screen } = await failed();
    expect(screen.asks()).toBe(1);
    request(session);
    expect(screen.asks()).toBe(2);
  });

  it('asks once while an answer is awaited: two requests, one load', async () => {
    const { session, screen } = await failed();
    session.setQuery('a');
    session.setQuery('ab');
    session.toggle('caseSensitive');
    session.step('previous');
    expect(screen.asks()).toBe(2);
    expect(screen.waiting()).toBe(1);
  });

  it('takes the words away when a request gets the finder, listens to it, and searches what the bar holds then: the retry is a search like any other', async () => {
    const { session, screen, finder } = await failed();
    session.setQuery('ab');
    expect(session.getSnapshot().unavailable).toBe(true);
    screen.answer(finder);
    await settled();
    expect(session.getSnapshot().unavailable).toBe(false);
    expect(finder.listeners()).toBe(1);
    expect(finder.calls).toEqual([{ direction: 'next', query: 'ab', options: OFF }]);
    finder.tell(state(0, 3));
    expect(session.getSnapshot()).toMatchObject({ unavailable: false, result: state(0, 3) });
  });

  it('tells its subscribers that the words are gone', async () => {
    const { session, screen, finder } = await failed();
    session.setQuery('ab');
    const heard: boolean[] = [];
    session.subscribe(() => {
      heard.push(session.getSnapshot().unavailable);
    });
    screen.answer(finder);
    await settled();
    expect(heard[0]).toBe(false);
  });

  it('keeps the words while the next attempt is awaited and when it fails too, and logs once: the same failure is not said again', async () => {
    const { session, screen, warnings } = await failed();
    session.setQuery('a');
    expect(session.getSnapshot().unavailable).toBe(true);
    screen.fail(new Error('the chunk did not load again'));
    await settled();
    expect(session.getSnapshot().unavailable).toBe(true);
    expect(warnings).toHaveLength(1);
    session.setQuery('ab');
    expect(screen.asks()).toBe(3);
  });

  it('keeps the words when the next attempt finds the emulator not made yet: only a finder takes them away', async () => {
    const { session, screen } = await failed();
    session.setQuery('a');
    screen.answer(undefined);
    await settled();
    expect(session.getSnapshot().unavailable).toBe(true);
  });

  it('asks nothing for a bar that is closed, whatever was said before: the words wait for the next opening, which asks again', async () => {
    const { session, screen } = await failed();
    session.close();
    session.setQuery('a');
    session.toggle('regex');
    session.screenReady();
    expect(screen.asks()).toBe(1);
    expect(session.getSnapshot().unavailable).toBe(true);
    session.open();
    expect(screen.asks()).toBe(2);
  });

  it('starts clean for another screen: the words were said about the screen that failed', async () => {
    const { session } = await failed();
    const other = fakeFindScreen({ held: true });
    session.bind(other);
    expect(session.getSnapshot().unavailable).toBe(false);
    expect(other.asks()).toBe(1);
  });

  it('does not take a late answer from a screen it is no longer bound to: its failure is not the new screen\'s', async () => {
    const first = rig({ held: true });
    first.session.open();
    const other = fakeFindScreen({ held: true });
    first.session.bind(other);
    first.screen.fail(new Error('the old screen failed late'));
    await settled();
    expect(first.session.getSnapshot().unavailable).toBe(false);
    expect(first.warnings).toHaveLength(0);
  });
});

// The emulator may be made after the bar is opened (the panel is shown, the chunk of the emulator is loading, and the person presses Find): the screen has no finder to give then. When it says that the emulator is there,
// a bar that is open asks again and searches what it holds, with no key pressed.
describe('the screen saying that its emulator is there', () => {
  it('searches what the bar holds when the bar was opened and typed in before the emulator existed: no further key is needed', async () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    session.setQuery('ab');
    expect(screen.asks()).toBe(1);
    screen.answer(undefined);
    await settled();
    expect(finder.calls).toEqual([]);
    expect(finder.listeners()).toBe(0);
    session.screenReady();
    expect(screen.asks()).toBe(2);
    screen.answer(finder);
    await settled();
    expect(finder.calls).toEqual([{ direction: 'next', query: 'ab', options: OFF }]);
    expect(finder.listeners()).toBe(1);
    finder.tell(state(1, 5));
    expect(session.getSnapshot().result).toEqual(state(1, 5));
  });

  it('asks nothing while the bar is closed: the emulator\'s search is not loaded for a bar nobody opened', () => {
    const { session, screen } = rig();
    session.screenReady();
    session.screenReady();
    expect(screen.asks()).toBe(0);
  });

  it('asks nothing of a bar that has its finder: the search is not run twice', async () => {
    const { session, screen, finder } = rig();
    session.open();
    await settled();
    session.setQuery('ab');
    const calls = finder.calls.length;
    session.screenReady();
    await settled();
    expect(screen.asks()).toBe(1);
    expect(finder.calls).toHaveLength(calls);
  });

  it('asks once when it is said again while the answer is awaited', () => {
    const { session, screen } = rig({ held: true });
    session.open();
    session.screenReady();
    session.screenReady();
    expect(screen.asks()).toBe(1);
  });

  it('looks for nothing when the bar holds nothing to look for, and listens to the finder all the same', async () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    screen.answer(undefined);
    await settled();
    session.screenReady();
    screen.answer(finder);
    await settled();
    expect(finder.calls).toEqual([]);
    expect(finder.listeners()).toBe(1);
  });
});

describe('the screen it is bound to', () => {
  it('changes nothing when it is bound to the screen it already has', async () => {
    const { session, screen, told } = rig();
    session.open();
    await settled();
    const before = session.getSnapshot();
    const heard = told.length;
    session.bind(screen);
    expect(session.getSnapshot()).toBe(before);
    expect(told).toHaveLength(heard);
  });

  it('closes an open bar when the screen is taken away, lets go of the finder, and does not touch the screen or the finder: they go together', async () => {
    const { session, screen, finder } = rig();
    session.open();
    await settled();
    session.setQuery('a');
    const focuses = screen.focuses();
    const clears = finder.clears();
    session.bind(undefined);
    expect(session.getSnapshot()).toMatchObject({ isOpen: false, result: undefined });
    expect(finder.listeners()).toBe(0);
    expect(screen.focuses()).toBe(focuses);
    expect(finder.clears()).toBe(clears);
  });

  it('asks a new screen for its finder, listens to it and searches it for what is in the field, and drops the old one\'s late answer', async () => {
    const first = rig({ held: true });
    const secondFinder = fakeFinder();
    const second = fakeFindScreen({ finder: secondFinder });
    first.session.open();
    first.session.setQuery('a');
    first.session.bind(second);
    await settled();
    expect(second.asks()).toBe(1);
    expect(secondFinder.listeners()).toBe(1);
    expect(secondFinder.calls).toEqual([{ direction: 'next', query: 'a', options: OFF }]);
    first.screen.answer(first.finder);
    await settled();
    expect(first.finder.listeners()).toBe(0);
    expect(first.finder.calls).toEqual([]);
    expect(first.session.getSnapshot().isOpen).toBe(true);
  });

  it('asks each screen once: a second screen is asked at the next opening of a bar that was closed', async () => {
    const { session, screen } = rig();
    session.open();
    await settled();
    session.close();
    const other = fakeFindScreen({ finder: fakeFinder() });
    session.bind(other);
    expect(other.asks()).toBe(0);
    session.open();
    await settled();
    session.close();
    session.open();
    expect(other.asks()).toBe(1);
    expect(screen.asks()).toBe(1);
  });
});

describe('subscribers', () => {
  it('are told after each change and are not told after they unsubscribe', () => {
    const { session } = rig();
    const heard: string[] = [];
    const stop = session.subscribe(() => {
      heard.push('x');
    });
    session.setQuery('a');
    session.open();
    expect(heard.length).toBeGreaterThanOrEqual(2);
    const count = heard.length;
    stop();
    session.setQuery('ab');
    expect(heard).toHaveLength(count);
  });
});

describe('closing the bar from the terminal (Escape pressed while the terminal has the keyboard)', () => {
  it('says that nothing was closed while the bar is closed, and does nothing: it neither clears nor takes the keyboard nor tells anyone, for the Escape is the shell\'s then', async () => {
    const { session, screen, finder, told } = rig();
    expect(session.closeIfOpen()).toBe(false);
    session.open();
    await settled();
    session.close();
    const clears = finder.clears();
    const focuses = screen.focuses();
    const heard = told.length;
    expect(session.closeIfOpen()).toBe(false);
    expect(finder.clears()).toBe(clears);
    expect(screen.focuses()).toBe(focuses);
    expect(told).toHaveLength(heard);
  });

  it('closes an open bar and says so: the highlights are cleared, the finder is let go of and the keyboard goes back to the terminal, as a close of the bar does', async () => {
    const { session, screen, finder } = rig();
    session.open();
    await settled();
    session.setQuery('foo');
    finder.tell(state(0, 4));
    expect(session.closeIfOpen()).toBe(true);
    expect(finder.clears()).toBe(1);
    expect(finder.listeners()).toBe(0);
    expect(screen.focuses()).toBe(1);
    expect(session.getSnapshot()).toMatchObject({ isOpen: false, result: undefined, input: { query: 'foo' } });
  });

  it('says so once: the Escape that closed the bar was the bar\'s, and the next one is the shell\'s', async () => {
    const { session } = rig();
    session.open();
    await settled();
    expect(session.closeIfOpen()).toBe(true);
    expect(session.closeIfOpen()).toBe(false);
  });

  it('closes a bar whose finder has not arrived yet, and gives the keyboard back', () => {
    const { session, screen, finder } = rig({ held: true });
    session.open();
    expect(session.closeIfOpen()).toBe(true);
    expect(finder.clears()).toBe(0);
    expect(screen.focuses()).toBe(1);
  });
});
