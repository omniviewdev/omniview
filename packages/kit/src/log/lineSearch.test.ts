// Search over the lines the viewer shows (HLT-10, HLT-11, HLT-12, MNR-L4), written as work counts, because a result that is right says nothing about
// whether a full scan was run for 100 new lines (docs/ui-next/optimisations.md 10.1, HLT-g11): a scan reads each line through the view, and the tests
// count those reads. The scan is chunked and time-boxed so it never holds a frame, and it keeps all three bounds of the carried engine.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineBuffer } from './lineBuffer';
import { LineSearch, SEARCH_CHUNK_LINES } from './lineSearch';
import { LineView } from './lineView';
import { MAX_MATCH_COUNT, SEARCH_TIME_BUDGET_MS } from './regexSafety';
import type { LineEntry, LogEntry, LogLevel } from './types';

// `execSafeSearchRange` reads `performance.now()` against a guard of 100 ms. A worker that is descheduled that long inside a chunk would stop a scan on a time cap and end a test that is about
// the work done and what was found: the clock stands still here, and the time guard has its own tests, with a clock that jumps.
beforeEach(() => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const entry = (n: number, text: string, level?: LogLevel): LineEntry => ({ kind: 'line', n, seq: n, source: '', timestamp: '', text, level, runs: undefined });

function setup(capacity = 200_000) {
  const buffer = new LineBuffer(capacity);
  const view = new LineView(buffer);
  const add = (text: string, level?: LogLevel) => {
    const evicted = buffer.push(entry(buffer.next, text, level));
    view.pushed(buffer.at(buffer.length - 1), evicted);
  };

  const addMany = (count: number, text: (n: number) => string) => {
    for (let index = 0; index < count; index += 1) {
      add(text(buffer.next));
    }
  };

  return { buffer, view, add, addMany, search: new LineSearch(view) };
}

const drain = (search: LineSearch, budgetMs = 5) => {
  let guard = 0;
  while (search.step(budgetMs)) {
    guard += 1;
    if (guard > 10_000) {
      throw new Error('a scan that never ends');
    }
  }
};

const literal = (query: string) => ({ query, regex: false, caseSensitive: false });

describe('the query', () => {
  it('is idle with no query: nothing to find, nothing scanned', () => {
    const { search, add } = setup();
    add('hello');
    search.configure(literal(''));
    expect(search.status).toBe('idle');
    expect(search.step(5)).toBe(false);
    expect(search.count).toBe(0);
    expect(search.pattern).toBeNull();
  });

  it.each(['(', '[', 'a{2,1}', '.*', 'x|', 'a?'])('is invalid as a regular expression when it is not one the search can run safely: %s', (query) => {
    const { search, add } = setup();
    add('hello');
    search.configure({ query, regex: true, caseSensitive: false });
    expect(search.status).toBe('invalid');
    expect(search.step(5)).toBe(false);
    expect(search.pattern).toBeNull();
  });

  it('takes a literal literally: the dot of "a.b" is a dot', () => {
    const { search, add } = setup();
    add('axb');
    add('a.b');
    search.configure(literal('a.b'));
    drain(search);
    expect(search.count).toBe(1);
    expect(search.at(0)).toBe(2);
  });

  it('is case blind unless asked, and a regular expression only when asked', () => {
    const { search, add } = setup();
    add('Request OK');
    add('request failed');
    add('response 200');
    search.configure(literal('REQUEST'));
    drain(search);
    expect([search.at(0), search.at(1), search.count]).toEqual([1, 2, 2]);
    search.configure({ query: 'REQUEST', regex: false, caseSensitive: true });
    drain(search);
    expect(search.count).toBe(0);
    search.configure({ query: 're(quest|sponse)', regex: true, caseSensitive: true });
    drain(search);
    expect(search.count).toBe(2);
    search.configure({ query: 're(quest|sponse)', regex: false, caseSensitive: true });
    drain(search);
    expect(search.count).toBe(0);
  });
});

describe('what it finds', () => {
  it('names the lines by ordinal, once each however many matches a line holds, and never a marker', () => {
    const { buffer, view, search, add } = setup();
    add('ab ab ab');
    const evicted = buffer.push({ kind: 'gap', n: buffer.next, dropped: 4 });
    view.pushed(buffer.at(buffer.length - 1), evicted);
    add('xx');
    add('ab');
    search.configure(literal('ab'));
    drain(search);
    expect(search.count).toBe(2);
    expect([search.at(0), search.at(1)]).toEqual([1, 4]);
    expect(search.hit(1)).toBe(true);
    expect(search.hit(2)).toBe(false);
    expect(search.hit(3)).toBe(false);
    expect(search.hit(4)).toBe(true);
    expect(search.indexOf(4)).toBe(1);
    expect(search.indexOf(3)).toBe(-1);
  });

  it('finds the line after and before an ordinal, and nothing past the ends', () => {
    const { search, addMany } = setup();
    addMany(20, (n) => (n % 5 === 0 ? 'hit' : 'miss'));
    search.configure(literal('hit'));
    drain(search);
    expect([search.at(0), search.at(1), search.at(2), search.at(3)]).toEqual([5, 10, 15, 20]);
    expect(search.after(0)).toBe(5);
    expect(search.after(5)).toBe(10);
    expect(search.after(7)).toBe(10);
    expect(search.after(20)).toBeUndefined();
    expect(search.before(21)).toBe(20);
    expect(search.before(10)).toBe(5);
    expect(search.before(5)).toBeUndefined();
  });

  it('searches the lines of the view only: a line the level filter hides is not a match', () => {
    const { view, search, add } = setup();
    add('needle in info', 'info');
    add('needle in error', 'error');
    view.setMinRank(3);
    search.configure(literal('needle'));
    drain(search);
    expect(search.count).toBe(1);
    expect(search.at(0)).toBe(2);
  });
});

describe('the scan is chunked and time-boxed', () => {
  it('reads a chunk at a time and stops when the budget of the slice is spent, so it never holds a frame', () => {
    const { view, search, addMany } = setup();
    addMany(20 * SEARCH_CHUNK_LINES, (n) => (n % 4 === 0 ? `line ${n} needle` : `line ${n} hay`));
    // A clock that moves with every reading: each chunk costs it 0.4 ms.
    let time = 0;
    const clocked = new LineSearch(view, () => {
      time += 0.2;
      return time;
    });
    clocked.configure(literal('needle'));
    const reads = vi.spyOn(view, 'at');
    const more = clocked.step(1);
    expect(more).toBe(true);
    expect(reads.mock.calls.length).toBeGreaterThan(0);
    expect(reads.mock.calls.length).toBeLessThan(20 * SEARCH_CHUNK_LINES);
    expect(clocked.status).toBe('scanning');
    // Slice after slice it reaches the end and the result is the one a single pass gives.
    drain(clocked, 1);
    expect(clocked.status).toBe('done');
    search.configure(literal('needle'));
    drain(search, 1000);
    expect(clocked.count).toBe(search.count);
    expect(clocked.count).toBe((20 * SEARCH_CHUNK_LINES) / 4);
  });

  it('always makes progress: a budget of nothing still scans one chunk', () => {
    const { search, addMany } = setup();
    addMany(3 * SEARCH_CHUNK_LINES, () => 'needle');
    search.configure(literal('needle'));
    search.step(0);
    expect(search.count).toBe(SEARCH_CHUNK_LINES);
  });
});

describe('what a new line or an old one costs (HLT-10, MNR-L4)', () => {
  it('100 appended lines scan a range of 100: the lines already scanned are not read again', () => {
    const { view, search, add, addMany } = setup();
    addMany(50_000, (n) => `line ${n}`);
    search.configure(literal('needle'));
    drain(search);
    expect(search.status).toBe('done');
    const reads = vi.spyOn(view, 'at');
    for (let index = 0; index < 100; index += 1) {
      add(index % 10 === 0 ? 'a needle' : 'nothing');
    }

    drain(search);
    expect(reads.mock.calls.length).toBe(100);
    expect(search.count).toBe(10);
    expect(search.status).toBe('done');
  });

  it('drops the matches of lines the buffer evicted without reading a line', () => {
    const { buffer, view, search, addMany } = setup(100);
    addMany(100, (n) => (n % 2 === 0 ? 'hit' : 'miss'));
    search.configure(literal('hit'));
    drain(search);
    expect(search.count).toBe(50);
    const reads = vi.spyOn(view, 'at');
    addMany(10, () => 'miss');
    search.trim(buffer.first);
    expect(buffer.first).toBe(11);
    expect(search.count).toBe(45);
    expect(search.at(0)).toBe(12);
    drain(search);
    // Only the ten new lines are read.
    expect(reads.mock.calls.length).toBe(10);
    expect(search.count).toBe(45);
  });

  it('starts over for a new query and for a new view: the scan is a full pass again', () => {
    const { view, search, addMany } = setup();
    addMany(1000, (n) => `line ${n} needle`);
    search.configure(literal('needle'));
    drain(search);
    const reads = vi.spyOn(view, 'at');
    search.configure(literal('line 9'));
    drain(search);
    expect(reads.mock.calls.length).toBe(1000);
    reads.mockClear();
    search.restart();
    expect(search.count).toBe(0);
    expect(search.status).toBe('scanning');
    drain(search);
    expect(reads.mock.calls.length).toBe(1000);
  });
});

describe('what the status says while lines are left to scan', () => {
  // A search that was done and has lines come after it is not done until it has read them: a status that stayed `done` through the slices of a large append would say "No results" (or give a
  // count that is not final) over a result that is partial.
  it('reads scanning while appended lines are left unsearched, and done after the last slice; an append that fits one slice never leaves done', () => {
    const { search, addMany } = setup();
    addMany(100, () => 'miss');
    search.configure(literal('hit'));
    drain(search);
    expect(search.status).toBe('done');

    addMany(3, () => 'miss');
    const version = search.version;
    expect(search.step(5)).toBe(false);
    expect(search.status).toBe('done');
    expect(search.version).toBe(version);

    // Two chunks and a slice of nothing: one is scanned and one is left.
    addMany(SEARCH_CHUNK_LINES + 1, () => 'miss');
    expect(search.step(0)).toBe(true);
    expect(search.status).toBe('scanning');
    expect(search.version).toBeGreaterThan(version);
    expect(search.step(0)).toBe(false);
    expect(search.status).toBe('done');
  });
});

describe('the bounds of the carried engine hold (HLT-11)', () => {
  it(`stops at ${MAX_MATCH_COUNT.toLocaleString('en-US')} matches, says so, and reads no line after that`, () => {
    const { view, search, add, addMany } = setup();
    addMany(MAX_MATCH_COUNT + 5000, () => 'needle');
    search.configure(literal('needle'));
    drain(search);
    expect(search.status).toBe('capped');
    expect(search.count).toBe(MAX_MATCH_COUNT);
    const reads = vi.spyOn(view, 'at');
    add('needle');
    drain(search);
    expect(reads.mock.calls.length).toBe(0);
    expect(search.count).toBe(MAX_MATCH_COUNT);
  });

  it('counts matches against the cap, not lines: one very long line of matches caps the search', () => {
    const { search, add } = setup();
    add('a'.repeat(MAX_MATCH_COUNT + 50));
    add('a');
    search.configure(literal('a'));
    drain(search);
    expect(search.status).toBe('capped');
    expect(search.count).toBe(1);
  });
});

describe('what the match cap bounds: the matches held, not the life of the stream (HLT-11)', () => {
  /** The ordinals of the lines the search holds, in the order it holds them. */
  const held = (search: LineSearch) => Array.from({ length: search.count }, (_, index) => search.at(index));
  /** The ordinals of the lines a spy on the view's `at` was asked for, in the order it was asked: the lines the scan read. */
  const readBy = (reads: { readonly mock: { readonly results: ReadonlyArray<{ readonly value: unknown }> } }) => reads.mock.results.map((result) => (result.value as LogEntry).n);

  it('resumes when eviction takes the held matches under the cap: the lines that came while it was stopped are read, and a match among them is found', () => {
    const { buffer, search, add, addMany } = setup(MAX_MATCH_COUNT);
    addMany(MAX_MATCH_COUNT, () => 'needle');
    search.configure(literal('needle'));
    drain(search);
    expect([search.status, search.count]).toEqual(['capped', MAX_MATCH_COUNT]);
    // A hundred lines come and miss; the head loses the hundred oldest matches. The search is not told of the lines that came, only of the head.
    addMany(100, () => 'quiet');
    search.trim(buffer.first);
    expect(buffer.first).toBe(101);
    // The cap bounds what is held, and there is room again: the lines it never read are still to be read.
    expect(search.status).toBe('scanning');
    drain(search);
    expect(search.status).toBe('done');
    expect(search.count).toBe(MAX_MATCH_COUNT - 100);
    add('a needle');
    search.trim(buffer.first);
    drain(search);
    expect(search.at(search.count - 1)).toBe(buffer.next - 1);
    expect(search.hit(buffer.next - 1)).toBe(true);
  });

  it('resumes after the last line it read, never from the start: a line it had read is not read again (MNR-L4)', () => {
    const { buffer, view, search, addMany } = setup(MAX_MATCH_COUNT + 100);
    addMany(MAX_MATCH_COUNT + 100, () => 'needle');
    search.configure(literal('needle'));
    drain(search);
    // The cap fell on line 10,000: the last 100 lines were never read.
    expect([search.status, search.count]).toEqual(['capped', MAX_MATCH_COUNT]);
    addMany(30, () => 'needle');
    search.trim(buffer.first);
    expect(buffer.first).toBe(31);
    const reads = vi.spyOn(view, 'at');
    drain(search);
    // Thirty matches were given back: it read the thirty lines after the last one it had read, and stopped at the cap again with exactly the cap held.
    expect(readBy(reads)).toEqual(Array.from({ length: 30 }, (_, index) => MAX_MATCH_COUNT + 1 + index));
    expect([search.status, search.count]).toEqual(['capped', MAX_MATCH_COUNT]);
    expect([search.at(0), search.at(search.count - 1)]).toEqual([31, MAX_MATCH_COUNT + 30]);
  });

  it('gives back matches, not lines: a line of three matches frees three, and the line the cap cut is read on from where the cap fell, so a resumed scan holds what a fresh one does', () => {
    const { buffer, view, search, addMany } = setup(3400);
    addMany(3400, () => 'ab ab ab');
    search.configure(literal('ab'));
    drain(search);
    // 3,333 lines of three matches make 9,999; the first match of line 3,334 is the 10,000th, and the cap falls inside that line.
    expect([search.status, search.count, search.at(search.count - 1)]).toEqual(['capped', 3334, 3334]);
    addMany(2, () => 'quiet');
    search.trim(buffer.first);
    const reads = vi.spyOn(view, 'at');
    drain(search);
    // The two oldest lines gave back six matches: the two that line 3,334 still held after the cap, the three of line 3,335 and the first of line 3,336. It is at the cap again, not a
    // match short and not a match over, and holds what a search that starts now over the same lines holds.
    expect(readBy(reads)).toEqual([3334, 3335, 3336]);
    expect([search.status, search.count, search.at(0), search.at(search.count - 1)]).toEqual(['capped', 3334, 3, 3336]);
    reads.mockRestore();
    const fresh = new LineSearch(view);
    fresh.configure(literal('ab'));
    drain(fresh);
    expect([fresh.status, held(fresh)]).toEqual([search.status, held(search)]);
  });

  // The cap can fall INSIDE a line that has several matches, and that line was half read. If the scan went on at the next line, the matches that line still held would be lost, and a
  // search that a fresh scan says is capped could say it is done, so the count would lose its `+`.
  it('continues in the line the cap cut when that line is still held: lines of 9,999, 2 and 9,998 matches are capped after the first line goes, as a fresh scan says', () => {
    const { buffer, view, search, add } = setup(3);
    add('a'.repeat(9999));
    add('aa');
    add('a'.repeat(9998));
    search.configure(literal('a'));
    drain(search);
    // The cap falls on the first match of the second line.
    expect([search.status, held(search)]).toEqual(['capped', [1, 2]]);
    // The first line goes with the head, and a line with no match comes.
    add('x');
    search.trim(buffer.first);
    expect(search.status).toBe('scanning');
    drain(search);
    expect([search.status, held(search)]).toEqual(['capped', [2, 3]]);
    const fresh = new LineSearch(view);
    fresh.configure(literal('a'));
    drain(fresh);
    expect([fresh.status, held(fresh)]).toEqual(['capped', [2, 3]]);
  });

  it('starts at the first line that is left when the head took the line the cap cut, and holds no line twice', () => {
    const { buffer, search, add } = setup(2);
    add('a'.repeat(9999));
    add('aa');
    search.configure(literal('a'));
    drain(search);
    expect([search.status, held(search)]).toEqual(['capped', [1, 2]]);
    // Both lines go with the head: a line of three matches and a line of none come.
    add('aaa');
    add('x');
    search.trim(buffer.first);
    drain(search);
    expect([search.status, held(search)]).toEqual(['done', [3]]);
  });

  it('does not read again a line the cap fell at the end of: nothing is left in it to find', () => {
    const { buffer, view, search, addMany } = setup(MAX_MATCH_COUNT + 10);
    addMany(MAX_MATCH_COUNT + 10, () => 'needle');
    search.configure(literal('needle'));
    drain(search);
    expect([search.status, search.count]).toEqual(['capped', MAX_MATCH_COUNT]);
    addMany(5, () => 'quiet');
    search.trim(buffer.first);
    const reads = vi.spyOn(view, 'at');
    drain(search);
    // The cap fell at the end of line 10,000: the first line read is 10,001.
    expect(readBy(reads)[0]).toBe(MAX_MATCH_COUNT + 1);
    expect(new Set(held(search)).size).toBe(search.count);
  });

  it('stops after the last line it read when the cap falls inside a chunk, so a resumed scan neither reads a line twice nor skips one, and holds what a fresh scan would', () => {
    // A line in ten misses, so the 10,000th match is on line 11,111: inside the chunk of lines 10,753 to 11,264 (the 22nd), 359 lines into it.
    const total = 22 * SEARCH_CHUNK_LINES;
    const { buffer, view, search, addMany } = setup(total);
    const text = (n: number) => (n % 10 === 0 ? 'quiet' : 'needle');
    addMany(total, text);
    search.configure(literal('needle'));
    drain(search);
    expect(search.status).toBe('capped');
    expect(search.at(search.count - 1)).toBe(11_111);
    // Sixty lines come and the head loses sixty, fifty-four of them matches.
    addMany(60, text);
    search.trim(buffer.first);
    const reads = vi.spyOn(view, 'at');
    drain(search);
    const read = readBy(reads);
    // It began on the line after the one the cap fell on, not at the start of the chunk the cap fell in, and read no line twice.
    expect(read[0]).toBe(11_112);
    expect(new Set(read).size).toBe(read.length);
    // The lines it holds are ascending and unique, and are the ones a search that starts now over the same lines holds.
    const fresh = new LineSearch(view);
    fresh.configure(literal('needle'));
    drain(fresh);
    expect(held(search)).toEqual(held(fresh));
    expect(held(search).at(0)).toBe(61);
    expect(held(search).at(-1)).toBe(11_171);
  });

  it('does not resume a search the time guard stopped: the pattern is slow, not the result full, and it would stop again', () => {
    const { buffer, view, addMany } = setup(600);
    addMany(600, () => 'needle');
    const search = new LineSearch(view, () => 0);
    search.configure(literal('needle'));
    // The carried engine reads its clock at the end of a chunk of 512 lines: a clock that has jumped past its budget by then stops it there.
    let readings = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (readings++ === 0 ? 0 : SEARCH_TIME_BUDGET_MS + 1));
    try {
      drain(search);
    } finally {
      clock.mockRestore();
    }

    // One chunk read, 512 matches: nowhere near the cap on matches.
    expect([search.status, search.count]).toEqual(['capped', SEARCH_CHUNK_LINES]);
    addMany(100, () => 'needle');
    search.trim(buffer.first);
    const reads = vi.spyOn(view, 'at');
    drain(search);
    // The head lost a hundred matches and there is room under the cap, and it stays stopped and reads nothing.
    expect([search.status, search.count]).toEqual(['capped', SEARCH_CHUNK_LINES - 100]);
    expect(reads.mock.calls.length).toBe(0);
  });
});

describe('what a change of the version says', () => {
  it('moves with every change of the result and of the status, and with nothing else', () => {
    const { search, add } = setup();
    add('needle');
    const versions = [search.version];
    search.configure(literal('needle'));
    versions.push(search.version);
    drain(search);
    versions.push(search.version);
    const settled = search.version;
    expect(search.step(5)).toBe(false);
    expect(search.version).toBe(settled);
    expect(new Set(versions).size).toBe(3);
  });
});
