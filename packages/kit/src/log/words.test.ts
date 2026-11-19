// The sentences of the log view that are decisions, not layout: the find count (FBR1: a fixed lane, so its text may change or go), what an empty list
// says, and how a failure is told. Pure functions of state, so the words are pinned in one place.
import { describe, expect, it } from 'vitest';
import { countText, emptyText, failureWords, type CountInput } from './words';

const base: CountInput = { options: { query: 'x', regex: false, caseSensitive: false }, status: 'done', count: 12, position: 3, capped: false };
const count = (over: Partial<CountInput> = {}) => countText({ ...base, ...over });

describe('countText', () => {
  it('says which match of how many', () => {
    expect(count()).toBe('3 of 12');
    expect(count({ count: 1430, position: 1430 })).toBe('1,430 of 1,430');
  });

  it('says there is none', () => {
    expect(count({ count: 0, position: 0 })).toBe('No results');
  });

  it('says nothing for an empty query, and nothing while a first pass has found nothing yet', () => {
    expect(count({ status: 'idle', options: { query: '', regex: false, caseSensitive: false }, count: 0, position: 0 })).toBe('');
    expect(count({ status: 'scanning', count: 0, position: 0 })).toBe('');
  });

  it('says the pattern cannot be used', () => {
    expect(count({ status: 'invalid', count: 0, position: 0 })).toBe('Invalid pattern');
  });

  it('marks a count that a bound cut short with a plus', () => {
    expect(count({ status: 'capped', capped: true, count: 3412, position: 7 })).toBe('7 of 3,412+');
  });

  it('says the search stopped, and never "No results", when a bound cut it short before it found a line: "No results" says the whole log was searched', () => {
    expect(count({ status: 'capped', capped: true, count: 0, position: 0 })).toBe('Search stopped');
    // The same count with the whole log searched is a result.
    expect(count({ status: 'done', capped: false, count: 0, position: 0 })).toBe('No results');
  });
});

describe('emptyText', () => {
  it('says the stream is connecting while it starts', () => {
    expect(emptyText({ state: 'starting', filtered: false, buffered: 0 })).toEqual({ text: 'Connecting…', clear: false });
  });

  it('says it waits for lines while it streams or is paused with none', () => {
    expect(emptyText({ state: 'streaming', filtered: false, buffered: 0 }).text).toBe('Waiting for lines…');
    expect(emptyText({ state: 'paused', filtered: false, buffered: 0 }).text).toBe('Waiting for lines…');
  });

  it('says there are no lines when the log is over with none', () => {
    expect(emptyText({ state: 'ended', filtered: false, buffered: 0 }).text).toBe('There are no lines.');
    expect(emptyText({ state: 'failed', filtered: false, buffered: 0 }).text).toBe('There are no lines.');
  });

  it('says the filter hides every line, and offers the way back, when lines exist that the level hides', () => {
    expect(emptyText({ state: 'streaming', filtered: true, buffered: 40 })).toEqual({ text: 'No lines match the filters.', clear: true });
    expect(emptyText({ state: 'ended', filtered: true, buffered: 3 }).clear).toBe(true);
  });

  it('does not blame the filter when the buffer is empty', () => {
    expect(emptyText({ state: 'streaming', filtered: true, buffered: 0 })).toEqual({ text: 'Waiting for lines…', clear: false });
  });
});

describe('failureWords', () => {
  it('names what failed in the words of the mock and gives the cause as the source said it', () => {
    expect(failureWords({ stage: 'create', message: 'The plugin is not running' }, false)).toEqual({
      title: 'Couldn\'t start the log stream',
      message: 'The plugin is not running.',
    });
  });

  it('says it stopped when it had been running', () => {
    expect(failureWords({ stage: 'source', source: 'source/app', message: 'connection reset by peer.' }, true)).toEqual({
      title: 'The log stream stopped',
      message: 'connection reset by peer.',
    });
  });

  it('ends the cause with a full stop, once, and never leaves it empty', () => {
    expect(failureWords({ stage: 'session', message: 'Failed to reconnect after 5 attempts' }, true).message).toBe('Failed to reconnect after 5 attempts.');
    expect(failureWords({ stage: 'session', message: 'It broke?' }, true).message).toBe('It broke?');
    expect(failureWords({ stage: 'session', message: '   ' }, true).message).toBe('The source gave no reason.');
  });
});
