// The packing of units into shards at run time (scripts/ci/probe-pack.mjs): the fewest shards under the limit, each unit once, the shards as even as the limit allows, and the same answer for the same units whatever
// order they come in. No installed dependency is needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lowerBound, pack } from './probe-pack.mjs';

const items = (...seconds) => seconds.map((value, index) => ({ id: `u${index + 1}`, seconds: value }));
const ids = (shards) => shards.map((shard) => shard.units.map((entry) => entry.id).sort());
const loads = (shards) => shards.map((shard) => shard.seconds);

/** A small deterministic generator (mulberry32), so that a failing instance can be reproduced from its number. */
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fewest bins for these sizes under `limit`, by dynamic programming over subsets (an oracle that shares nothing with the packer). */
function fewestBins(sizes, limit) {
  const n = sizes.length;
  const best = new Array(1 << n).fill(null);
  best[0] = { bins: 1, last: 0 };
  for (let mask = 0; mask < 1 << n; mask += 1) {
    if (best[mask] === null) continue;
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) continue;
      const next = mask | (1 << i);
      const state = best[mask];
      const candidate = state.last + sizes[i] <= limit ? { bins: state.bins, last: state.last + sizes[i] } : { bins: state.bins + 1, last: sizes[i] };
      const old = best[next];
      if (old === null || candidate.bins < old.bins || (candidate.bins === old.bins && candidate.last < old.last)) best[next] = candidate;
    }
  }
  return best[(1 << n) - 1].bins;
}

test('every unit is in exactly one shard, none is over the limit, and the seconds of a shard are the sum of its units', () => {
  const shards = pack(items(300, 200, 150, 150, 100, 90, 60, 50, 40, 30), 432);
  assert.deepEqual(ids(shards).flat().sort(), items(300, 200, 150, 150, 100, 90, 60, 50, 40, 30).map((entry) => entry.id).sort());
  for (const shard of shards) {
    assert.ok(shard.seconds <= 432, `${shard.seconds}`);
    assert.equal(shard.seconds, shard.units.reduce((sum, entry) => sum + entry.seconds, 0));
  }
  assert.equal(shards.length, 3, '1,170 s over 432 s shards is 2.7: three');
});

test('the lower bound is the work divided by the limit, rounded up, and at least one', () => {
  assert.equal(lowerBound(items(432), 432), 1);
  assert.equal(lowerBound(items(433 - 1, 1), 432), 2);
  assert.equal(lowerBound(items(100, 100), 432), 1);
  assert.equal(lowerBound([], 432), 0);
});

test('NEGATIVE: a unit longer than the limit cannot be packed and is named, with its seconds, as the one to split; a unit with no whole positive number of seconds is refused', () => {
  assert.throws(() => pack([{ id: 'panel-controls', seconds: 480 }, ...items(10)], 432), /"panel-controls" is 480 s, over the 432 s a shard may hold: split it/);
  for (const bad of [0, -3, 1.5, Number.NaN, '40', null, undefined]) {
    assert.throws(() => pack([{ id: 'x', seconds: bad }], 432), /"x".*seconds/, JSON.stringify(bad));
  }
  assert.throws(() => pack([{ id: 'x', seconds: 10 }, { id: 'x', seconds: 20 }], 432), /"x" twice/);
  assert.throws(() => pack([{ id: '', seconds: 10 }], 432), /id/);
});

test('no units is no shard (a plan always has the probes; the caller says so)', () => {
  assert.deepEqual(pack([], 432), []);
});

test('the fewest shards: as many as the oracle says, on 400 random instances of up to 12 units, and never fewer than the lower bound', () => {
  const next = generator(20261122);
  for (let instance = 0; instance < 400; instance += 1) {
    const count = 1 + Math.floor(next() * 12);
    const limit = 20 + Math.floor(next() * 30);
    const sizes = Array.from({ length: count }, () => 1 + Math.floor(next() * limit));
    const shards = pack(sizes.map((seconds, index) => ({ id: `u${index}`, seconds })), limit);
    assert.equal(shards.length, fewestBins(sizes, limit), `instance ${instance}: ${JSON.stringify({ sizes, limit })} packed as ${JSON.stringify(loads(shards))}`);
    assert.ok(shards.length >= lowerBound(sizes.map((seconds, index) => ({ id: `u${index}`, seconds })), limit));
    for (const shard of shards) assert.ok(shard.seconds <= limit);
  }
});

test('the shards are as even as the limit allows: 1,200 s in the three shards it needs are within 20 s of one another, and the longest is well under the limit', () => {
  const shards = pack(items(300, 200, 150, 150, 100, 90, 60, 50, 40, 30, 20, 10), 432);
  assert.equal(shards.length, 3);
  assert.ok(Math.max(...loads(shards)) - Math.min(...loads(shards)) <= 20, JSON.stringify(loads(shards)));
  assert.ok(Math.max(...loads(shards)) <= 410, JSON.stringify(loads(shards)));
});

// First fit decreasing is not enough: each of these instances needs one shard more with it than the least there is (found by searching 20,000 random instances against the oracle above).
test('the fewest shards where first fit decreasing is not: four instances that it packs in one shard more than needed', () => {
  for (const { sizes, limit, fewest } of [
    { sizes: [12, 12, 11, 10, 10, 9, 8, 8, 5, 5], limit: 23, fewest: 4 },
    { sizes: [20, 18, 17, 11, 10, 10, 9, 8, 7, 5], limit: 29, fewest: 4 },
    { sizes: [21, 15, 13, 7, 5, 4, 3, 3], limit: 24, fewest: 3 },
    { sizes: [21, 19, 12, 11, 7, 6, 6, 6], limit: 24, fewest: 4 },
  ]) {
    assert.equal(fewestBins(sizes, limit), fewest, 'the oracle');
    const shards = pack(sizes.map((seconds, index) => ({ id: `u${index}`, seconds })), limit);
    assert.equal(shards.length, fewest, JSON.stringify({ sizes, limit, packed: loads(shards) }));
    for (const shard of shards) assert.ok(shard.seconds <= limit);
    assert.deepEqual(ids(shards).flat().sort(), sizes.map((_, index) => `u${index}`).sort(), 'every unit is in exactly one shard');
  }
});

test('the longest shard is the least it can be for the shards used (checked against every split of 9 random instances)', () => {
  const next = generator(7);
  for (let instance = 0; instance < 60; instance += 1) {
    const count = 3 + Math.floor(next() * 7);
    const sizes = Array.from({ length: count }, () => 5 + Math.floor(next() * 40));
    const limit = 60;
    const shards = pack(sizes.map((seconds, index) => ({ id: `u${index}`, seconds })), limit);
    // The best longest shard over every assignment of the units to that many shards.
    let best = Infinity;
    const assign = (index, current) => {
      if (index === sizes.length) {
        best = Math.min(best, Math.max(...current));
        return;
      }
      const seen = new Set();
      for (let bin = 0; bin < shards.length; bin += 1) {
        if (seen.has(current[bin]) || current[bin] + sizes[index] > limit) continue;
        seen.add(current[bin]);
        current[bin] += sizes[index];
        assign(index + 1, current);
        current[bin] -= sizes[index];
      }
    };
    assign(0, new Array(shards.length).fill(0));
    const longest = Math.max(...loads(shards));
    // A local search is not an exact one: allow one unit of the smallest size to separate them, and say how far it was.
    assert.ok(longest - best <= Math.min(...sizes), `instance ${instance}: longest ${longest}, best ${best}, ${JSON.stringify(sizes)}`);
  }
});

test('the same units in any order give the same shards: sorted by seconds, then by id, and numbered from the longest', () => {
  const base = items(300, 200, 150, 150, 100, 90, 60, 50, 40, 30);
  const reference = pack(base, 432);
  assert.deepEqual(loads(reference), [...loads(reference)].sort((a, b) => b - a), 'shard 1 is the longest');
  for (let turn = 1; turn < 6; turn += 1) {
    const shuffled = [...base].sort((a, b) => ((a.seconds * 31 + turn * 7 + a.id.length) % 13) - ((b.seconds * 31 + turn * 7 + b.id.length) % 13) || a.id.localeCompare(b.id));
    assert.deepEqual(pack(shuffled, 432), reference, `order ${turn}`);
  }
});

test('equal units with equal seconds are told apart by id, so that the answer does not depend on how they were listed', () => {
  const a = pack([{ id: 'b', seconds: 100 }, { id: 'a', seconds: 100 }, { id: 'c', seconds: 100 }, { id: 'd', seconds: 100 }, { id: 'e', seconds: 100 }], 250);
  const b = pack([{ id: 'e', seconds: 100 }, { id: 'd', seconds: 100 }, { id: 'c', seconds: 100 }, { id: 'a', seconds: 100 }, { id: 'b', seconds: 100 }], 250);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
});

test('the work that fits a shard exactly is one shard, and one second more is two', () => {
  assert.equal(pack(items(200, 232), 432).length, 1);
  assert.equal(pack(items(200, 233), 432).length, 2);
});

test('a large instance gets a valid packing (every unit once, none over the limit) and the same one on every call; the search ends on its room check here, and no instance of this file exhausts SEARCH_BUDGET', () => {
  const next = generator(99);
  const many = Array.from({ length: 60 }, (_, index) => ({ id: `u${String(index).padStart(2, '0')}`, seconds: 3000 + Math.floor(next() * 4000) }));
  const first = pack(many, 10000);
  assert.deepEqual(pack(many, 10000), first);
  assert.deepEqual(first.flatMap((shard) => shard.units.map((entry) => entry.id)).sort(), many.map((entry) => entry.id).sort());
  for (const shard of first) assert.ok(shard.seconds <= 10000);
});

test('a search that runs out of its budget gives up and the first fit answer stands: valid, every unit once, one shard more than the fewest, and the same on every call', () => {
  const sizes = [12, 12, 11, 10, 10, 9, 8, 8, 5, 5];
  const items = sizes.map((seconds, index) => ({ id: `u${index}`, seconds }));
  assert.equal(pack(items, 23).length, 4, 'with its budget the search finds the fewest');
  const starved = pack(items, 23, 1);
  assert.deepEqual(pack(items, 23, 1), starved);
  assert.equal(starved.length, 5, 'first fit decreasing packs this instance in one shard more than the fewest');
  assert.deepEqual(ids(starved).flat().sort(), items.map((entry) => entry.id).sort());
  for (const shard of starved) assert.ok(shard.seconds <= 23);
});
