import { describe, expect, it, vi } from 'vitest';
import { createProblems } from './model';
import type { Condition, Problems } from './types';

// The model of the Problems tool (ch16 S74, S121): the conditions that are true NOW, as each producer says them. `set` replaces what one producer says, so a condition that is not in its list is gone at once, with
// nothing to clear and no unread state; the order, the counts and the badge are functions of the list; and every object the view reads keeps its identity while it says the same (the view reads them through
// `useSyncExternalStore`, and a row that did not change must not render again). The tests are plugin-agnostic: invented names.

const condition = (key: string, over: Partial<Condition> = {}): Condition => ({
  key,
  severity: 'error',
  label: 'Stopped',
  title: 'Alpha Cloud: The plugin process stopped unexpectedly.',
  source: { id: 'alpha', name: 'Alpha Cloud' },
  target: 'north',
  subject: { kind: 'plugin', plugin: 'alpha' },
  ...over,
});

/** The same condition as a producer builds it again on its next `set`: equal in every member, every nested object new. */
const again = (value: Condition): Condition => ({ ...value, source: { ...value.source }, subject: value.subject === undefined ? undefined : { ...value.subject } });

const keys = (problems: Problems): string[] => problems.getSnapshot().rows.map((row) => row.key);
const labels = (problems: Problems): string[] => problems.getSnapshot().rows.map((row) => row.label);

/** Every order `items` can be listed in. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }

  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe('the model at rest', () => {
  it('lists nothing, counts nothing and has no badge', () => {
    const snapshot = createProblems().getSnapshot();
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.counts).toEqual({ error: 0, warning: 0, info: 0 });
    expect(snapshot.badge).toBeUndefined();
  });

  it('answers the same snapshot until something changes', () => {
    const problems = createProblems();
    expect(problems.getSnapshot()).toBe(problems.getSnapshot());
  });
});

describe('set: what one producer says is true now', () => {
  it('lists what the producer says', () => {
    const problems = createProblems();
    problems.set('plugins', [condition('a'), condition('b', { source: { id: 'beta', name: 'Beta Cloud' } })]);
    expect(keys(problems)).toEqual(['a', 'b']);
  });

  it('drops a condition the moment its producer stops saying it: nothing to clear, nothing to acknowledge (S74)', () => {
    const problems = createProblems();
    problems.set('plugins', [condition('a'), condition('b')]);
    expect(keys(problems)).toEqual(['a', 'b']);
    problems.set('plugins', [condition('a')]);
    expect(keys(problems)).toEqual(['a']);
    problems.set('plugins', []);
    expect(keys(problems)).toEqual([]);
    expect(problems.getSnapshot().counts).toEqual({ error: 0, warning: 0, info: 0 });
  });

  it('replaces the list of that producer, it does not add to it', () => {
    const problems = createProblems();
    problems.set('plugins', [condition('a')]);
    problems.set('plugins', [condition('b')]);
    expect(keys(problems)).toEqual(['b']);
  });

  it('leaves what the other producers say as it is', () => {
    const problems = createProblems();
    problems.set('plugins', [condition('a')]);
    problems.set('connections', [condition('b')]);
    expect(keys(problems)).toEqual(['a', 'b']);
    problems.set('plugins', []);
    expect(keys(problems)).toEqual(['b']);
    problems.set('connections', [condition('c')]);
    problems.set('plugins', [condition('a')]);
    expect(keys(problems)).toEqual(['a', 'c']);
  });

  it('keeps nothing of the array it was given: a list the caller changes afterwards is not what the model says, and the caller\'s order is its own', () => {
    const problems = createProblems();
    const given = [condition('b', { severity: 'info' }), condition('a')];
    problems.set('plugins', given);
    expect(given.map((entry) => entry.key)).toEqual(['b', 'a']);
    expect(keys(problems)).toEqual(['a', 'b']);
    given.length = 0;
    expect(keys(problems)).toEqual(['a', 'b']);
    problems.set('plugins', [condition('a')]);
    expect(keys(problems)).toEqual(['a']);
  });
});

describe('the order of the rows (S121)', () => {
  it('lists the errors, then the warnings, then the infos', () => {
    const problems = createProblems();
    problems.set('p', [
      condition('i', { severity: 'info', source: { id: 'a', name: 'Alpha' } }),
      condition('w', { severity: 'warning', source: { id: 'b', name: 'Beta' } }),
      condition('e', { severity: 'error', source: { id: 'z', name: 'Zed' } }),
    ]);
    expect(keys(problems)).toEqual(['e', 'w', 'i']);
  });

  it('lists the sources of one severity by name: numbers by value and case ignored (the host\'s one collator)', () => {
    const problems = createProblems();
    const named = (key: string, name: string) => condition(key, { source: { id: key, name } });
    problems.set('p', [named('k-beta', 'beta'), named('k-ten', 'Alpha 10'), named('k-two', 'alpha 2'), named('k-plain', 'Alpha')]);
    expect(keys(problems)).toEqual(['k-plain', 'k-two', 'k-ten', 'k-beta']);
  });

  it('lists the targets of one source by name, and the conditions that have none after the ones that have', () => {
    const problems = createProblems();
    const aimed = (key: string, target: string | undefined) => condition(key, { target });
    problems.set('p', [aimed('none', undefined), aimed('ten', 'node 10'), aimed('two', 'Node 2'), aimed('none-2', undefined)]);
    expect(keys(problems)).toEqual(['two', 'ten', 'none', 'none-2']);
  });

  it('lists what is still equal by key', () => {
    const problems = createProblems();
    problems.set('p', [condition('b'), condition('c'), condition('a')]);
    expect(keys(problems)).toEqual(['a', 'b', 'c']);
  });

  it('is the same list in every order the conditions arrive in, and from whichever producer: texts that differ only in case still have one order', () => {
    const all = [
      condition('a', { source: { id: 'x', name: 'alpha' }, target: 'north' }),
      condition('b', { source: { id: 'y', name: 'Alpha' }, target: 'north' }),
      condition('c', { source: { id: 'x', name: 'alpha' }, target: undefined, severity: 'warning' }),
      condition('d', { source: { id: 'x', name: 'alpha' }, target: 'North' }),
      condition('e', { severity: 'info' }),
    ];
    // Equal in the source's name (case ignored), the target (case ignored) and the severity: the key is what tells `a`, `b` and `d` apart, and warnings and infos come after the errors.
    const wanted = ['a', 'b', 'd', 'c', 'e'];
    for (const listed of permutations(all)) {
      const problems = createProblems();
      problems.set('p', listed);
      expect(keys(problems), listed.map((entry) => entry.key).join(' ')).toEqual(wanted);
      const split = createProblems();
      split.set('q', listed.slice(0, 2));
      split.set('p', listed.slice(2));
      expect(keys(split), `split ${listed.map((entry) => entry.key).join(' ')}`).toEqual(wanted);
    }
  });

  it('orders the rows of every producer together, not one producer after another', () => {
    const problems = createProblems();
    problems.set('one', [condition('one-warning', { severity: 'warning' }), condition('one-error')]);
    problems.set('two', [condition('two-error', { source: { id: 'b', name: 'Beta Cloud' } }), condition('two-warning', { severity: 'warning', source: { id: 'b', name: 'Beta Cloud' } })]);
    expect(keys(problems)).toEqual(['one-error', 'two-error', 'one-warning', 'two-warning']);
  });
});

describe('the counts and the badge of the tab (S114)', () => {
  it('counts the conditions of each severity', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b'), condition('c', { severity: 'warning' }), condition('d', { severity: 'info' }), condition('e', { severity: 'info' }), condition('f', { severity: 'info' })]);
    expect(problems.getSnapshot().counts).toEqual({ error: 2, warning: 1, info: 3 });
  });

  it('is a count of the errors when there is one: "1 error"', () => {
    const problems = createProblems();
    problems.set('p', [condition('a')]);
    expect(problems.getSnapshot().badge).toEqual({ kind: 'count', count: 1, label: '1 error' });
  });

  it('is a count of the errors when there are several: "3 errors"', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b'), condition('c')]);
    expect(problems.getSnapshot().badge).toEqual({ kind: 'count', count: 3, label: '3 errors' });
  });

  it('counts the errors and leaves the warnings out of it', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b'), condition('c', { severity: 'warning' }), condition('d', { severity: 'warning' })]);
    expect(problems.getSnapshot().badge).toEqual({ kind: 'count', count: 2, label: '2 errors' });
  });

  it('is a dot for the warnings when there is no error: "1 warning"', () => {
    const problems = createProblems();
    problems.set('p', [condition('a', { severity: 'warning' }), condition('b', { severity: 'info' })]);
    expect(problems.getSnapshot().badge).toEqual({ kind: 'dot', tone: 'warning', label: '1 warning' });
  });

  it('is a dot for the warnings when there is no error: "4 warnings"', () => {
    const problems = createProblems();
    problems.set('p', [1, 2, 3, 4].map((number) => condition(`w${String(number)}`, { severity: 'warning' })));
    expect(problems.getSnapshot().badge).toEqual({ kind: 'dot', tone: 'warning', label: '4 warnings' });
  });

  it('is nothing for infos: an info never badges the tab', () => {
    const problems = createProblems();
    problems.set('p', [condition('a', { severity: 'info' }), condition('b', { severity: 'info' })]);
    expect(problems.getSnapshot().counts).toEqual({ error: 0, warning: 0, info: 2 });
    expect(problems.getSnapshot().badge).toBeUndefined();
  });

  it('follows the conditions at once: the last error that goes leaves the warnings\' dot, the last problem that goes leaves nothing', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b', { severity: 'warning' })]);
    expect(problems.getSnapshot().badge).toEqual({ kind: 'count', count: 1, label: '1 error' });
    problems.set('p', [condition('b', { severity: 'warning' })]);
    expect(problems.getSnapshot().badge).toEqual({ kind: 'dot', tone: 'warning', label: '1 warning' });
    problems.set('p', []);
    expect(problems.getSnapshot().badge).toBeUndefined();
  });
});

describe('identity: an object that says the same is the same object', () => {
  it('keeps the object of a condition that a new list says again in every member, though the producer built it anew with every nested object new', () => {
    const problems = createProblems();
    const first = [condition('a'), condition('b', { severity: 'warning', target: undefined, subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' } }), condition('c', { subject: undefined })];
    problems.set('p', first);
    const held = problems.getSnapshot().rows;
    expect(held).toHaveLength(3);
    problems.set('p', first.map(again));
    const after = problems.getSnapshot().rows;
    expect(after).toHaveLength(3);
    after.forEach((row, index) => {
      expect(row).toBe(held[index]);
    });
  });

  // One change of one member is a new object: a row whose cell shows the member must be asked to draw again.
  const CHANGES: ReadonlyArray<readonly [string, Partial<Condition>]> = [
    ['its severity changes', { severity: 'warning' }],
    ['its label changes', { label: 'Did not start' }],
    ['its title changes', { title: 'Alpha Cloud: The plugin could not start.' }],
    ['the id of its source changes', { source: { id: 'alpha-2', name: 'Alpha Cloud' } }],
    ['the name of its source changes', { source: { id: 'alpha', name: 'Alpha Cloud 2' } }],
    ['its target changes', { target: 'south' }],
    ['its target goes away', { target: undefined }],
    ['its subject becomes a connection', { subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' } }],
    ['the plugin of its subject changes', { subject: { kind: 'plugin', plugin: 'beta' } }],
    ['its subject goes away', { subject: undefined }],
  ];

  it.each(CHANGES)('is a new object, with the new member, when %s', (_name, change) => {
    const problems = createProblems();
    problems.set('p', [condition('a')]);
    const [before] = problems.getSnapshot().rows;
    problems.set('p', [condition('a', change)]);
    const [after] = problems.getSnapshot().rows;
    expect(before).toBeDefined();
    expect(after).not.toBe(before);
    expect(after).toEqual(condition('a', change));
  });

  it('is a new object when its subject, a connection, names another connection', () => {
    const problems = createProblems();
    problems.set('p', [condition('a', { subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' } })]);
    const [before] = problems.getSnapshot().rows;
    problems.set('p', [condition('a', { subject: { kind: 'connection', plugin: 'alpha', connection: 'c-2' } })]);
    const [after] = problems.getSnapshot().rows;
    expect(before).toBeDefined();
    expect(after).not.toBe(before);
    expect(after?.subject).toEqual({ kind: 'connection', plugin: 'alpha', connection: 'c-2' });
  });

  it('leaves the other rows alone when one changes: a change of one record is not a new object for the others', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b'), condition('c')]);
    const held = problems.getSnapshot().rows;
    problems.set('p', [condition('a'), condition('b', { label: 'Timed out' }), condition('c')]);
    const after = problems.getSnapshot().rows;
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(held[0]);
    expect(after[1]).not.toBe(held[1]);
    expect(after[2]).toBe(held[2]);
    expect(labels(problems)).toEqual(['Stopped', 'Timed out', 'Stopped']);
  });

  it('keeps the snapshot, the rows, the counts and the badge when a list says what it said', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b', { severity: 'warning' })]);
    const held = problems.getSnapshot();
    expect(held.rows).toHaveLength(2);
    expect(held.badge).toBeDefined();
    problems.set('p', [condition('a'), condition('b', { severity: 'warning' })].map(again));
    const after = problems.getSnapshot();
    expect(after).toBe(held);
    expect(after.rows).toBe(held.rows);
    expect(after.counts).toBe(held.counts);
    expect(after.badge).toBe(held.badge);
  });

  it('keeps them when the list comes in another order: the order is the model\'s', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b'), condition('c')]);
    const held = problems.getSnapshot();
    expect(held.rows).toHaveLength(3);
    problems.set('p', [condition('c'), condition('a'), condition('b')]);
    expect(problems.getSnapshot()).toBe(held);
  });

  it('keeps the counts and the badge, but not the rows or the snapshot, when a row changes and the numbers and the words do not', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b', { severity: 'warning' })]);
    const held = problems.getSnapshot();
    problems.set('p', [condition('a', { label: 'Did not start' }), condition('b', { severity: 'warning' })]);
    const after = problems.getSnapshot();
    expect(after).not.toBe(held);
    expect(after.rows).not.toBe(held.rows);
    expect(after.counts).toBe(held.counts);
    expect(after.badge).toBe(held.badge);
  });

  it('keeps the badge, but not the counts, when the counts change and the badge says the same', () => {
    const problems = createProblems();
    problems.set('p', [condition('a'), condition('b')]);
    const held = problems.getSnapshot();
    expect(held.badge).toEqual({ kind: 'count', count: 2, label: '2 errors' });
    problems.set('p', [condition('a'), condition('b'), condition('c', { severity: 'warning' }), condition('d', { severity: 'info' })]);
    const after = problems.getSnapshot();
    expect(after.counts).not.toBe(held.counts);
    expect(after.counts).toEqual({ error: 2, warning: 1, info: 1 });
    expect(after.badge).toBe(held.badge);
  });

  it('makes a new badge when its words change: a count of 2 errors is not the object of 1 error', () => {
    const problems = createProblems();
    problems.set('p', [condition('a')]);
    const held = problems.getSnapshot();
    problems.set('p', [condition('a'), condition('b')]);
    expect(problems.getSnapshot().badge).not.toBe(held.badge);
    expect(problems.getSnapshot().badge).toEqual({ kind: 'count', count: 2, label: '2 errors' });
  });

  it('makes a new rows array and a new snapshot when a row came or went', () => {
    const problems = createProblems();
    problems.set('p', [condition('a')]);
    const held = problems.getSnapshot();
    problems.set('p', [condition('a'), condition('b', { severity: 'info' })]);
    expect(problems.getSnapshot()).not.toBe(held);
    expect(problems.getSnapshot().rows).not.toBe(held.rows);
    expect(problems.getSnapshot().rows[0]).toBe(held.rows[0]);
    problems.set('p', [condition('a')]);
    expect(keys(problems)).toEqual(['a']);
  });
});

describe('who is told, and when', () => {
  it('tells its listeners once after a set that changed what the tool says, and they read the new state', () => {
    const problems = createProblems();
    const seen: string[][] = [];
    problems.subscribe(() => {
      seen.push(keys(problems));
    });
    problems.set('p', [condition('a'), condition('b')]);
    expect(seen).toEqual([['a', 'b']]);
    problems.set('p', [condition('a')]);
    expect(seen).toEqual([['a', 'b'], ['a']]);
  });

  it('tells every listener, once each', () => {
    const problems = createProblems();
    const first = vi.fn();
    const second = vi.fn();
    problems.subscribe(first);
    problems.subscribe(second);
    problems.set('p', [condition('a')]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('tells nobody for a set with a list that says what the producer said: the same objects, new objects that are equal, the same conditions in another order', () => {
    const problems = createProblems();
    const list = [condition('a'), condition('b', { severity: 'warning' })];
    problems.set('p', list);
    expect(keys(problems)).toEqual(['a', 'b']);
    const listener = vi.fn();
    problems.subscribe(listener);
    problems.set('p', list);
    problems.set('p', list.map(again));
    problems.set('p', [...list].reverse().map(again));
    expect(listener).not.toHaveBeenCalled();
  });

  it('tells nobody for an empty list of a producer that said nothing, and nobody for a producer that was never heard of', () => {
    const problems = createProblems();
    const listener = vi.fn();
    problems.subscribe(listener);
    problems.set('p', []);
    problems.set('q', []);
    expect(listener).not.toHaveBeenCalled();
    problems.set('p', [condition('a')]);
    expect(listener).toHaveBeenCalledTimes(1);
    problems.set('q', []);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells nobody when a list differs from the last one only in a duplicate that the first of its key wins over', () => {
    const problems = createProblems();
    problems.set('p', [condition('a')]);
    const listener = vi.fn();
    problems.subscribe(listener);
    problems.set('p', [condition('a'), condition('a', { label: 'Timed out', severity: 'warning' })]);
    expect(listener).not.toHaveBeenCalled();
    expect(labels(problems)).toEqual(['Stopped']);
  });

  it('tells nobody again for the one condition whose last change was already told', () => {
    const problems = createProblems();
    const listener = vi.fn();
    problems.subscribe(listener);
    problems.set('p', [condition('a')]);
    problems.set('p', [condition('a', { label: 'Timed out' })]);
    problems.set('p', [condition('a', { label: 'Timed out' })]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('is told ONCE for two hundred conditions that arrive in one set, with all of them listed', () => {
    const problems = createProblems();
    const listener = vi.fn();
    problems.subscribe(listener);
    problems.set('p', Array.from({ length: 200 }, (_, index) => condition(`c-${String(index).padStart(3, '0')}`, { severity: (['error', 'warning', 'info'] as const)[index % 3] ?? 'info', target: `item-${String(index)}` })));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(problems.getSnapshot().rows).toHaveLength(200);
    expect(problems.getSnapshot().counts).toEqual({ error: 67, warning: 67, info: 66 });
  });

  it('stops telling a listener once it stopped, and tells the others', () => {
    const problems = createProblems();
    const stopped = vi.fn();
    const kept = vi.fn();
    const stop = problems.subscribe(stopped);
    problems.subscribe(kept);
    problems.set('p', [condition('a')]);
    stop();
    problems.set('p', [condition('b')]);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledTimes(2);
  });

  it('does not tell a listener that was stopped by another listener in the same notification', () => {
    const problems = createProblems();
    const later = vi.fn();
    let stopLater: () => void = () => undefined;
    const first = vi.fn(() => {
      stopLater();
    });
    problems.subscribe(first);
    stopLater = problems.subscribe(later);
    problems.set('p', [condition('a')]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  });
});

describe('a key that is said twice', () => {
  it('is its first condition when it appears twice in one list: the first wins', () => {
    const problems = createProblems();
    problems.set('p', [condition('a', { label: 'First' }), condition('a', { label: 'Second', severity: 'warning' }), condition('b')]);
    expect(keys(problems)).toEqual(['a', 'b']);
    expect(problems.getSnapshot().rows[0]?.label).toBe('First');
    expect(problems.getSnapshot().counts).toEqual({ error: 2, warning: 0, info: 0 });
  });

  it('is shown as the producer that said it last says it, and a later set of the first producer does not take it back', () => {
    const problems = createProblems();
    problems.set('first', [condition('k', { label: 'First says' })]);
    problems.set('second', [condition('k', { label: 'Second says' })]);
    expect(labels(problems)).toEqual(['Second says']);
    // The first producer lists it again, with other words, beside another condition: it said it before the second did, so the second's version stays.
    problems.set('first', [condition('k', { label: 'First again' }), condition('j', { label: 'Other' })]);
    expect(problems.getSnapshot().rows.map((row) => `${row.key}:${row.label}`).sort()).toEqual(['j:Other', 'k:Second says']);
    expect(problems.getSnapshot().counts.error).toBe(2);
  });

  it('tells nobody and keeps every object when only the version that is not shown changes', () => {
    const problems = createProblems();
    problems.set('first', [condition('k', { label: 'First says' })]);
    problems.set('second', [condition('k', { label: 'Second says' })]);
    const held = problems.getSnapshot();
    expect(labels(problems)).toEqual(['Second says']);
    const listener = vi.fn();
    problems.subscribe(listener);
    problems.set('first', [condition('k', { label: 'First changed' })]);
    expect(listener).not.toHaveBeenCalled();
    expect(problems.getSnapshot()).toBe(held);
  });

  it('shows the first producer\'s version again when the second stops saying the key: the first still says it', () => {
    const problems = createProblems();
    problems.set('first', [condition('k', { label: 'First says' })]);
    problems.set('second', [condition('k', { label: 'Second says' })]);
    problems.set('first', [condition('k', { label: 'First now' })]);
    problems.set('second', []);
    expect(labels(problems)).toEqual(['First now']);
    problems.set('first', []);
    expect(keys(problems)).toEqual([]);
  });

  it('is gone when no producer says it', () => {
    const problems = createProblems();
    problems.set('first', [condition('k')]);
    problems.set('second', [condition('k')]);
    problems.set('second', []);
    expect(keys(problems)).toEqual(['k']);
    problems.set('first', []);
    expect(keys(problems)).toEqual([]);
    expect(problems.getSnapshot().badge).toBeUndefined();
  });

  it('is said anew by a producer that dropped it and says it again: the one that says it last wins', () => {
    const problems = createProblems();
    problems.set('first', [condition('k', { label: 'First says' })]);
    problems.set('second', [condition('k', { label: 'Second says' })]);
    problems.set('first', []);
    problems.set('first', [condition('k', { label: 'First says again' })]);
    expect(labels(problems)).toEqual(['First says again']);
  });

  it('keeps the object it shows when the producer that says it last says it in every member as the one before', () => {
    const problems = createProblems();
    problems.set('first', [condition('k')]);
    const [held] = problems.getSnapshot().rows;
    const listener = vi.fn();
    problems.subscribe(listener);
    problems.set('second', [condition('k')]);
    expect(held).toBeDefined();
    expect(problems.getSnapshot().rows[0]).toBe(held);
    expect(listener).not.toHaveBeenCalled();
  });
});
