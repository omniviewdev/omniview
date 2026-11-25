import { describe, expect, it, vi } from 'vitest';
import { createActivityFeed, subjectOf, type ActivityRecordLike, type SourceResolver } from './activity';

// The shared side of the two tools: how a record's source says what a row is about, and the feed the window's one activity subscription hands to both.

const resolver: SourceResolver = {
  plugin: (id) => (id === undefined ? { id: 'host', name: 'Omniview' } : { id, name: id === 'alpha' ? 'Alpha Cloud' : id }),
  connection: (plugin, key) => (plugin === 'alpha' && key === 'c-1' ? 'north' : undefined),
};

const record = (id: string): ActivityRecordLike => ({
  id,
  kind: 'task',
  severity: 'info',
  createdAt: '2026-11-24T10:00:00Z',
  source: {},
  presentation: { title: id },
  task: { state: 'running', cancellation: 'unsupported' },
  visibility: { read: false },
});

describe('the subject of a record (what its row goes to)', () => {
  it('is the connection when the record names one the window knows', () => {
    expect(subjectOf({ pluginID: 'alpha', connectionID: 'c-1' }, resolver)).toEqual({ kind: 'connection', plugin: 'alpha', connection: 'c-1' });
  });

  it('is the plugin when the connection is not one the window knows: a row never goes to a key it cannot open', () => {
    expect(subjectOf({ pluginID: 'alpha', connectionID: 'gone' }, resolver)).toEqual({ kind: 'plugin', plugin: 'alpha' });
  });

  it('is the plugin when the record names no connection', () => {
    expect(subjectOf({ pluginID: 'alpha' }, resolver)).toEqual({ kind: 'plugin', plugin: 'alpha' });
  });

  it('is nothing for the host\'s own work: a record that names no plugin has no page of its own', () => {
    expect(subjectOf({}, resolver)).toBeUndefined();
    expect(subjectOf({ connectionID: 'c-1' }, resolver)).toBeUndefined();
  });
});

describe('the activity feed', () => {
  it('holds the records the provider pushed, the same array until they change', () => {
    const { feed, push } = createActivityFeed({ cancel: async () => undefined, markRead: async () => undefined });
    expect(feed.getSnapshot()).toEqual([]);
    const first = [record('a')];
    push(first);
    expect(feed.getSnapshot()).toBe(first);
    expect(feed.getSnapshot()).toBe(feed.getSnapshot());
  });

  it('tells its listeners once for each push of another array, and for no push of the one it has', () => {
    const { feed, push } = createActivityFeed({ cancel: async () => undefined, markRead: async () => undefined });
    const listener = vi.fn();
    const stop = feed.subscribe(listener);
    const records = [record('a'), record('b')];
    push(records);
    push(records);
    expect(listener).toHaveBeenCalledTimes(1);
    push([record('a')]);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    push([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('asks the host what the tools ask of it, with the id and nothing else', async () => {
    const cancel = vi.fn(async () => 'canceled');
    const markRead = vi.fn(async () => 'read');
    const { feed } = createActivityFeed({ cancel, markRead });
    await expect(feed.cancel('t-1')).resolves.toBe('canceled');
    await expect(feed.markRead('t-2')).resolves.toBe('read');
    expect(cancel).toHaveBeenCalledWith('t-1');
    expect(markRead).toHaveBeenCalledWith('t-2');
  });
});

// A failed observation of the service is not an empty service: with no records the two look the same, so the feed carries the provider's failure beside its records and the tools say which one it is.
describe('the activity feed: whether the service can be observed', () => {
  const calls = { cancel: async () => undefined, markRead: async () => undefined };
  const SENTENCE = 'The activity service did not answer.';

  it('has no error until a push carries one', () => {
    const { feed } = createActivityFeed(calls);
    expect(feed.getError()).toBeUndefined();
  });

  it('holds the sentence a push carries, beside the records of the same push', () => {
    const { feed, push } = createActivityFeed(calls);
    const records = [record('a')];
    push(records, SENTENCE);
    expect(feed.getError()).toBe(SENTENCE);
    expect(feed.getSnapshot()).toBe(records);
  });

  it('answers the same sentence until it changes', () => {
    const { feed, push } = createActivityFeed(calls);
    push([record('a')], SENTENCE);
    expect(feed.getError()).toBe(feed.getError());
  });

  it('has no error again when a push carries none: absent means the service can be observed', () => {
    const { feed, push } = createActivityFeed(calls);
    const records = [record('a')];
    push(records, SENTENCE);
    push(records);
    expect(feed.getError()).toBeUndefined();
    expect(feed.getSnapshot()).toBe(records);
  });

  it('tells its listeners when only the error changes, once for each change, and the records are the same array', () => {
    const { feed, push } = createActivityFeed(calls);
    const records = [record('a')];
    push(records);
    const listener = vi.fn();
    feed.subscribe(listener);
    push(records, SENTENCE);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot()).toBe(records);
    push(records);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(feed.getSnapshot()).toBe(records);
  });

  it('does not tell its listeners of a push that says what the feed already says: the same array and the same sentence', () => {
    const { feed, push } = createActivityFeed(calls);
    const records = [record('a')];
    push(records, SENTENCE);
    const listener = vi.fn();
    feed.subscribe(listener);
    push(records, SENTENCE);
    expect(listener).not.toHaveBeenCalled();
  });

  it('tells its listeners once when the records and the error change in the same push, and the error is already the new one when they hear', () => {
    const { feed, push } = createActivityFeed(calls);
    const heard: Array<string | undefined> = [];
    feed.subscribe(() => {
      heard.push(feed.getError());
    });
    push([record('a')], SENTENCE);
    expect(heard).toEqual([SENTENCE]);
    push([record('b')]);
    expect(heard).toEqual([SENTENCE, undefined]);
  });

  it('tells its listeners of a failure that comes before any record: the provider failed on its first read', () => {
    const { feed, push } = createActivityFeed(calls);
    const listener = vi.fn();
    feed.subscribe(listener);
    push([], SENTENCE);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(feed.getError()).toBe(SENTENCE);
    expect(feed.getSnapshot()).toEqual([]);
  });
});
