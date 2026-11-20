import { describe, expect, it } from 'vitest';
import { LogSources, SOURCE_HUES } from './sources';

// The sources a log view has heard of (L2): the ones lines name and the ones the feed lists. A source has a tag: its id, the label the view shows for it, and the hue of its place in the series. The
// view tells sources apart only when there is more than one, and an unnamed line (`source: ''`) is no source.

describe('the hues of the series', () => {
  it('are the mock\'s own, in its order (shell-panel.js SRC_COLORS), and are the hues an ANSI span may take', () => {
    expect(SOURCE_HUES).toEqual(['blue', 'green', 'amber', 'purple', 'cyan', 'red', 'gray']);
  });
});

describe('the sources lines name', () => {
  it('count none while no line has named one, and a line that names none is no source', () => {
    const sources = new LogSources();
    expect(sources.count).toBe(0);
    sources.note('');
    expect(sources.count).toBe(0);
    expect(sources.tag('')).toBeUndefined();
  });

  it('are numbered in the order they first spoke: each takes the next hue of the series, the label is the id until the feed says another', () => {
    const sources = new LogSources();
    sources.note('svc/app');
    sources.note('svc/sidecar');
    expect(sources.count).toBe(2);
    expect(sources.tag('svc/app')).toEqual({ id: 'svc/app', label: 'svc/app', hue: 'blue' });
    expect(sources.tag('svc/sidecar')).toEqual({ id: 'svc/sidecar', label: 'svc/sidecar', hue: 'green' });
  });

  it('keep the hue of their first place when they speak again, in any order', () => {
    const sources = new LogSources();
    for (const id of ['a', 'b', 'a', 'b', 'b', 'a']) {
      sources.note(id);
    }

    expect(sources.tag('a')?.hue).toBe('blue');
    expect(sources.tag('b')?.hue).toBe('green');
    expect(sources.count).toBe(2);
  });

  it('give the same tag object for a source for as long as it is the same: a row compares it by identity', () => {
    const sources = new LogSources();
    sources.note('a');
    const first = sources.tag('a');
    sources.note('a');
    sources.note('b');
    expect(sources.tag('a')).toBe(first);
  });

  it('start the series again after the seventh: the eighth source has the first hue (the mock does the same, `i % 7`), and every one has a name that is text', () => {
    const sources = new LogSources();
    const ids = Array.from({ length: 9 }, (_, index) => `source-${String(index)}`);
    ids.forEach((id) => {
      sources.note(id);
    });
    expect(ids.map((id) => sources.tag(id)?.hue)).toEqual([...SOURCE_HUES, 'blue', 'green']);
    expect(ids.every((id) => sources.tag(id)?.label === id)).toBe(true);
  });
});

describe('the sources the feed lists', () => {
  it('are heard of before they speak: they count, in the order the feed lists them, each with the next hue', () => {
    const sources = new LogSources();
    expect(sources.learn([{ id: 'x' }, { id: 'y', label: 'Why' }])).toBe(true);
    expect(sources.count).toBe(2);
    expect(sources.tag('x')).toEqual({ id: 'x', label: 'x', hue: 'blue' });
    expect(sources.tag('y')).toEqual({ id: 'y', label: 'Why', hue: 'green' });
  });

  it('give a source a label it did not have, and change nothing else: only that source\'s tag is a new object', () => {
    const sources = new LogSources();
    sources.note('a');
    sources.note('b');
    const a = sources.tag('a');
    const b = sources.tag('b');
    expect(sources.learn([{ id: 'a' }, { id: 'b', label: 'worker' }])).toBe(true);
    expect(sources.tag('a')).toBe(a);
    expect(sources.tag('b')).not.toBe(b);
    expect(sources.tag('b')).toEqual({ id: 'b', label: 'worker', hue: 'green' });
  });

  it('keep the hue a source had when its line came before its listing', () => {
    const sources = new LogSources();
    sources.note('late');
    sources.learn([{ id: 'early' }, { id: 'late', label: 'Late' }]);
    expect(sources.tag('late')?.hue).toBe('blue');
    expect(sources.tag('early')?.hue).toBe('green');
  });

  it('say nothing changed for the same list again, a list that is not there, and a list that says what is known', () => {
    const sources = new LogSources();
    const list = [{ id: 'a', label: 'Alpha' }, { id: 'b' }];
    expect(sources.learn(list)).toBe(true);
    expect(sources.learn(list)).toBe(false);
    expect(sources.learn(undefined)).toBe(false);
    expect(sources.learn([{ id: 'a', label: 'Alpha' }, { id: 'b' }])).toBe(false);
  });

  it('follow the latest listing for a name: a later listing without a label, or with an empty one, gives the id again (the rows of the log and the card of the host say the same, each from the listing it has), and only that source\'s tag is a new object', () => {
    const sources = new LogSources();
    sources.learn([{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]);
    const b = sources.tag('b');
    expect(sources.learn([{ id: 'a' }, { id: 'b', label: 'Beta' }])).toBe(true);
    expect(sources.tag('a')).toEqual({ id: 'a', label: 'a', hue: 'blue' });
    expect(sources.tag('b')).toBe(b);
    expect(sources.learn([{ id: 'a', label: '' }, { id: 'b', label: 'Beta' }])).toBe(false);
    expect(sources.tag('a')?.label).toBe('a');
    expect(sources.learn([{ id: 'a', label: 'Alpha again' }, { id: 'b', label: 'Beta' }])).toBe(true);
    expect(sources.tag('a')?.label).toBe('Alpha again');
  });

  it('keep the last name of a source the feed no longer lists: its lines are still in the log', () => {
    const sources = new LogSources();
    sources.learn([{ id: 'a', label: 'Alpha' }, { id: 'b' }]);
    expect(sources.learn([{ id: 'b' }])).toBe(false);
    expect(sources.tag('a')?.label).toBe('Alpha');
    expect(sources.count).toBe(2);
  });

  it('do not count a source that names no id', () => {
    const sources = new LogSources();
    expect(sources.learn([{ id: '' }, { id: 'a' }])).toBe(true);
    expect(sources.count).toBe(1);
  });

  it('count each source once, whether the feed or a line named it first', () => {
    const sources = new LogSources();
    sources.note('a');
    sources.learn([{ id: 'a' }, { id: 'b' }]);
    sources.note('b');
    expect(sources.count).toBe(2);
  });
});
