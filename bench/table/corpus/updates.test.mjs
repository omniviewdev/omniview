import assert from 'node:assert/strict';
import test from 'node:test';

import { createUpdates, rng } from './updates.mjs';

const CREATED = Date.parse('2026-11-16T09:00:00Z');

/** `count` frozen Running 1/1 rows, so a mutation of an input row fails the test. */
function makeRows(count) {
  return Array.from({ length: count }, (_, index) => Object.freeze({
    key: `uid-${index}`,
    name: `pod-${index}-abcde`,
    namespace: `ns-${index % 3}`,
    nameTail: 6,
    ready: Object.freeze({ ready: 1, total: 1 }),
    status: Object.freeze({ word: 'Running', role: 'running' }),
    restarts: 0,
    createdAt: CREATED + index * 1000,
    node: 'node-1',
    ip: `10.0.0.${index % 250}`,
  }));
}

/** Run `events` events and add up what the workload reports. */
function run(updates, rows, events) {
  const total = { touched: [], removed: 0, added: 0 };
  let current = rows;
  for (let event = 0; event < events; event++) {
    const result = updates.apply(current);
    current = result.rows;
    total.touched.push(...result.touched);
    total.removed += result.removed;
    total.added += result.added;
  }

  return { rows: current, ...total };
}

const kinds = (touched, kind) => touched.filter((item) => item.kind === kind).length;

test('rng is the render bench generator: mulberry32, seeded, in [0, 1)', () => {
  const a = rng(1);
  const b = rng(1);
  const first = Array.from({ length: 5 }, () => a());
  assert.deepEqual(first, Array.from({ length: 5 }, () => b()));
  assert.ok(first.every((value) => value >= 0 && value < 1));
  assert.notDeepEqual(first, Array.from({ length: 5 }, rng(2)));
  // mulberry32 of seed 1 (the value the TypeScript original gives for the same four lines).
  assert.equal(first[0], 0.6270739405881613);
});

test('the same seed gives the same sequence, another seed another one', () => {
  const rows = makeRows(200);
  const again = run(createUpdates({ seed: 7 }), rows, 100);
  const first = run(createUpdates({ seed: 7 }), rows, 100);
  assert.deepEqual(again, first);
  assert.notDeepEqual(run(createUpdates({ seed: 8 }), rows, 100).touched, first.touched);
});

test('the next call continues the sequence: two calls are not one call twice', () => {
  const rows = makeRows(200);
  const updates = createUpdates({});
  const one = updates.apply(rows);
  const two = updates.apply(rows);
  assert.notDeepEqual(one.touched, two.touched);
  // ...and splitting a run in two instances at the same seed starts both from the start.
  assert.deepEqual(createUpdates({}).apply(rows).touched, one.touched);
});

test('unchanged rows keep their identity; the input is not touched; recreated rows go to the end', () => {
  const rows = makeRows(200);
  const copy = [...rows];
  const result = createUpdates({ recordsPerEvent: 5, recreateEvery: 3 }).apply(rows);

  assert.notEqual(result.rows, rows);
  assert.deepEqual(rows, copy);
  assert.equal(result.touched.length, 5);
  assert.equal(result.removed, result.added);
  assert.ok(result.removed > 0, 'recreateEvery 3 over five touches recreates at least one Pod');

  const gone = new Set(result.touched.filter((item) => item.kind === 'recreate').map((item) => item.previousKey));
  const replaced = new Set(result.touched.filter((item) => item.kind !== 'recreate').map((item) => item.key));
  const survivors = rows.filter((row) => !gone.has(row.key));
  // The array is the survivors in order, replaced rows in their positions, then the new incarnations.
  assert.equal(result.rows.length, rows.length);
  survivors.forEach((row, index) => {
    if (replaced.has(row.key)) {
      assert.notEqual(result.rows[index], row, `${row.key} changed, so it is a new object`);
      assert.equal(result.rows[index].key, row.key);
    } else {
      assert.equal(result.rows[index], row, `${row.key} did not change, so it is the same object`);
    }
  });

  const tail = result.rows.slice(survivors.length);
  assert.equal(tail.length, result.added);
  for (const row of tail) {
    assert.ok(!rows.some((old) => old.key === row.key), 'a recreated row has a new key');
  }
});

test('one Pod, in order: phase flip, restart, then (every third) recreation', () => {
  const [row] = makeRows(1);
  const updates = createUpdates({ recordsPerEvent: 1, recreateEvery: 3 });

  const flipped = updates.apply([row]);
  assert.equal(flipped.touched[0].kind, 'phase');
  assert.deepEqual(flipped.rows[0].status, { word: 'Pending', role: 'progress' });
  assert.deepEqual(flipped.rows[0].ready, { ready: 0, total: 1 });
  assert.equal(flipped.rows[0].restarts, 0);
  assert.equal(flipped.rows[0].key, row.key);

  const restarted = updates.apply(flipped.rows);
  assert.equal(restarted.touched[0].kind, 'restart');
  assert.equal(restarted.rows[0].restarts, 1);
  assert.deepEqual(restarted.rows[0].status, { word: 'Pending', role: 'progress' });

  const recreated = updates.apply(restarted.rows);
  assert.deepEqual([recreated.touched[0].kind, recreated.removed, recreated.added], ['recreate', 1, 1]);
  assert.equal(recreated.rows.length, 1);
  const [now] = recreated.rows;
  assert.notEqual(now.key, row.key);
  assert.match(now.key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(now.createdAt, row.createdAt + 3_600_000);
  assert.equal(now.restarts, 0);
  assert.deepEqual(now.status, { word: 'Running', role: 'running' });
  assert.deepEqual(now.ready, { ready: 1, total: 1 });
  assert.deepEqual([now.name, now.namespace, now.node, now.ip], [row.name, row.namespace, row.node, row.ip]);

  const flippedBack = createUpdates({ recordsPerEvent: 1, recreateEvery: 0 });
  const down = flippedBack.apply([row]).rows;
  const up = flippedBack.apply(flippedBack.apply(down).rows);
  assert.deepEqual(up.rows[0].status, { word: 'Running', role: 'running' }, 'a second flip returns to Running');
});

test('the ledger after 100 events is what the spec implies', () => {
  // 100 events x 2 Pods = 200 touches. Every 10th recreates: 20. Of the other 180, the even ones restart (200 touches have 100 even,
  // 20 of them multiples of 10) and the odd ones flip the phase: 80 restarts, 100 phase flips.
  const rows = makeRows(1000);
  const result = run(createUpdates({ eventsPerSecond: 5, recordsPerEvent: 2, recreateEvery: 10, seed: 1 }), rows, 100);

  assert.equal(result.touched.length, 200);
  assert.equal(kinds(result.touched, 'recreate'), 20);
  assert.equal(kinds(result.touched, 'restart'), 80);
  assert.equal(kinds(result.touched, 'phase'), 100);
  assert.deepEqual([result.removed, result.added], [20, 20]);
  assert.equal(result.rows.length, 1000);

  // The address of a Pod never changes: the same names and namespaces, and no key is used twice.
  const address = (row) => `${row.namespace}/${row.name}`;
  assert.deepEqual(result.rows.map(address).sort(), rows.map(address).sort());
  assert.equal(new Set(result.rows.map((row) => row.key)).size, 1000);
});

test('recreateEvery 0 never recreates, and the rows keep their positions', () => {
  const rows = makeRows(50);
  const result = run(createUpdates({ recreateEvery: 0 }), rows, 100);

  assert.equal(kinds(result.touched, 'recreate'), 0);
  assert.deepEqual([result.removed, result.added], [0, 0]);
  assert.deepEqual(result.rows.map((row) => row.key), rows.map((row) => row.key));
});

test('a Pod with no restart count or status starts from zero and becomes Running', () => {
  const bare = Object.freeze({ key: 'k', name: 'a', namespace: '', nameTail: 0, ready: undefined, status: undefined, restarts: undefined, createdAt: undefined, node: undefined, ip: undefined });
  const updates = createUpdates({ recordsPerEvent: 1, recreateEvery: 0 });
  const first = updates.apply([bare]).rows[0];
  assert.deepEqual(first.status, { word: 'Running', role: 'running' });
  assert.deepEqual(first.ready, { ready: 1, total: 1 });
  assert.equal(updates.apply([first]).rows[0].restarts, 1);
  assert.equal(createUpdates({ recordsPerEvent: 1, recreateEvery: 1 }).apply([bare]).rows[0].createdAt, undefined);
});

test('an invalid spec or too few rows throws', () => {
  assert.throws(() => createUpdates({ eventsPerSecond: 0 }), /eventsPerSecond/);
  assert.throws(() => createUpdates({ eventsPerSecond: Number.NaN }), /eventsPerSecond/);
  assert.throws(() => createUpdates({ recordsPerEvent: 0 }), /recordsPerEvent/);
  assert.throws(() => createUpdates({ recordsPerEvent: 1.5 }), /recordsPerEvent/);
  assert.throws(() => createUpdates({ recreateEvery: -1 }), /recreateEvery/);
  assert.throws(() => createUpdates({ seed: 0.5 }), /seed/);
  assert.throws(() => createUpdates({ recordsPerEvent: 3 }).apply(makeRows(2)), /exceeds the rows/);
});
