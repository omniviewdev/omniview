import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCounts, countLines, mustBeExact, parseRowName } from './counts.mjs';

// What a sidebar row says and what kubectl says it must (counts.mjs), with the controls: each way a count can be wrong is one the comparison must see, and the right ones must pass.

test('parseRowName reads the label and the count of a row as the host names it', () => {
  assert.deepEqual(parseRowName('Pods 50'), { label: 'Pods', precision: 'exact', value: 50 });
  assert.deepEqual(parseRowName('Pods 1,234'), { label: 'Pods', precision: 'exact', value: 1234 });
  assert.deepEqual(parseRowName('Deployments about 11'), { label: 'Deployments', precision: 'estimate', value: 11 });
  assert.deepEqual(parseRowName('ConfigMaps about 1,234'), { label: 'ConfigMaps', precision: 'estimate', value: 1234 });
  assert.deepEqual(parseRowName('Jobs 0'), { label: 'Jobs', precision: 'exact', value: 0 });
  assert.deepEqual(parseRowName('Secrets'), { label: 'Secrets', precision: 'none' });
  assert.deepEqual(parseRowName('Access control'), { label: 'Access control', precision: 'none' });
});

test('parseRowName does not take a word for a count', () => {
  assert.deepEqual(parseRowName('Pods about'), { label: 'Pods about', precision: 'none' });
  assert.deepEqual(parseRowName('Pods 1,23'), { label: 'Pods 1,23', precision: 'none' });
});

test('countLines counts the lines kubectl printed, blank ones aside', () => {
  assert.equal(countLines('a  1\nb  2\n\n'), 2);
  assert.equal(countLines(''), 0);
});

test('mustBeExact holds a kind of none or one, and the open kind, to an exact count', () => {
  assert.equal(mustBeExact(0, false), true);
  assert.equal(mustBeExact(1, false), true);
  assert.equal(mustBeExact(2, false), false);
  assert.equal(mustBeExact(50, true), true);
});

const expected = { Pods: 50, Deployments: 11, Nodes: 1, Jobs: 0 };

test('compareCounts passes the right counts: the open kind exact, an estimate or an exact count above one, exact for none and one', () => {
  assert.deepEqual(compareCounts({ rows: ['Pods 50', 'Deployments about 11', 'Nodes 1', 'Jobs 0'], expected, open: 'Pods' }), []);
  assert.deepEqual(compareCounts({ rows: ['Pods 50', 'Deployments 11', 'Nodes 1', 'Jobs 0'], expected, open: 'Pods' }), []);
});

test('control: compareCounts sees one too many, one too few and a missing row', () => {
  const rows = ['Pods 51', 'Deployments about 10', 'Nodes 1'];
  const problems = compareCounts({ rows, expected, open: 'Pods' });
  assert.deepEqual(problems, ['Pods: the row says 51, kubectl lists 50', 'Deployments: the row says 10, kubectl lists 11', 'Jobs: no such row in the sidebar']);
});

test('control: compareCounts sees a row with no count where kubectl lists objects, and where it lists none', () => {
  assert.deepEqual(compareCounts({ rows: ['Pods 50', 'Deployments', 'Nodes 1', 'Jobs'], expected, open: 'Pods' }), ['Deployments: the row has no count, kubectl lists 11', 'Jobs: the row has no count, kubectl lists 0']);
});

test('control: compareCounts sees an estimate where the list is open and where the kind has one object or none', () => {
  const problems = compareCounts({ rows: ['Pods about 50', 'Deployments about 11', 'Nodes about 1', 'Jobs about 0'], expected, open: 'Pods' });
  assert.deepEqual(problems, [
    'Pods: the count is estimate where 50 objects are known exactly (the list is open)',
    'Nodes: the count is estimate where 1 objects are known exactly',
    'Jobs: the count is estimate where 0 objects are known exactly',
  ]);
});

test('control: compareCounts does not take a number from a row of another kind: a count for the wrong label is a missing row', () => {
  assert.deepEqual(compareCounts({ rows: ['Pod 50'], expected: { Pods: 50 }, open: 'Pods' }), ['Pods: no such row in the sidebar']);
});
