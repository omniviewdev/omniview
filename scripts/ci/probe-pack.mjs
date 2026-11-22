// The packing of the units of a run into shards, at run time (N25): the fewest shards that each stay under the limit, each unit in one, the shards as even as that allows.
//
// A shard is a job: its time is its setup (about 90 s) plus the seconds of its units, so the number of shards is the first cost (every one repeats the setup and takes a runner) and the longest shard is the wall time.
// So: find the fewest shards (an exact search over the units, longest first, bounded in its work; first fit decreasing when the bound is reached), then even them out (longest-first onto the shortest shard, and moves and swaps
// that shorten the longest one). The answer depends only on the ids and seconds of the units, not on the order they are given in: units are sorted by seconds, longest first, then by id.
//
// The units keep only their measured seconds (docs/ui-next/status/N25.md): no pull request assigns a unit to a shard, so two that add units cannot conflict on one.

/** How many placements the exact search may try, in all. A run has about 35 units and the search finds its answer in a few hundred; the bound is for an instance nobody has written. */
export const SEARCH_BUDGET = 400_000;

const byLongest = (a, b) => b.seconds - a.seconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The fewest shards the work could fit in at the best: the seconds divided by the limit, rounded up; zero for no work. */
export function lowerBound(items, limit) {
  const total = items.reduce((sum, entry) => sum + entry.seconds, 0);
  return total === 0 ? 0 : Math.ceil(total / limit);
}

function validate(items, limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`the limit of a shard is a whole number of seconds, not ${JSON.stringify(limit)}`);
  const seen = new Set();
  for (const entry of items) {
    if (typeof entry.id !== 'string' || entry.id === '') throw new Error(`a unit needs an id, not ${JSON.stringify(entry.id)}`);
    if (seen.has(entry.id)) throw new Error(`the unit "${entry.id}" twice: a unit runs once`);
    seen.add(entry.id);
    if (!Number.isInteger(entry.seconds) || entry.seconds < 1) throw new Error(`the unit "${entry.id}" has ${JSON.stringify(entry.seconds)} seconds: a whole, positive number of seconds is needed to pack it`);
    if (entry.seconds > limit) throw new Error(`the unit "${entry.id}" is ${entry.seconds} s, over the ${limit} s a shard may hold: split it (scripts/ci/probe-units)`);
  }
}

/** First fit decreasing: each unit, longest first, into the first shard it fits, a new one when none does. `sorted` is by longest; the result is a list of lists of indexes into it. */
function firstFit(sorted, limit) {
  const bins = [];
  const loads = [];
  sorted.forEach((entry, index) => {
    let bin = loads.findIndex((load) => load + entry.seconds <= limit);
    if (bin === -1) {
      bin = bins.length;
      bins.push([]);
      loads.push(0);
    }
    bins[bin].push(index);
    loads[bin] += entry.seconds;
  });
  return bins;
}

/** Longest first onto the shortest of `count` shards; null when that overfills one. */
function longestFirst(sorted, count, limit) {
  const bins = Array.from({ length: count }, () => []);
  const loads = new Array(count).fill(0);
  for (let index = 0; index < sorted.length; index += 1) {
    let bin = 0;
    for (let candidate = 1; candidate < count; candidate += 1) if (loads[candidate] < loads[bin]) bin = candidate;
    if (loads[bin] + sorted[index].seconds > limit) return null;
    bins[bin].push(index);
    loads[bin] += sorted[index].seconds;
  }
  return bins;
}

/**
 * Can the units be put in `count` shards under the limit? An exact search, longest unit first, trying each shard once per load (two shards with the same load are the same choice), and giving up on a branch when the
 * work left cannot fit the room left. Returns the shards (lists of indexes), null when there is no way, and undefined when `budget.left` ran out before it knew.
 */
function search(sorted, count, limit, budget) {
  const loads = new Array(count).fill(0);
  const bins = Array.from({ length: count }, () => []);
  const rest = new Array(sorted.length + 1).fill(0);
  for (let index = sorted.length - 1; index >= 0; index -= 1) rest[index] = rest[index + 1] + sorted[index].seconds;
  const place = (index) => {
    if (index === sorted.length) return true;
    if (budget.left <= 0) return undefined;
    budget.left -= 1;
    const room = loads.reduce((sum, load) => sum + (limit - load), 0);
    if (rest[index] > room) return false;
    const tried = new Set();
    for (let bin = 0; bin < count; bin += 1) {
      const load = loads[bin];
      if (load + sorted[index].seconds > limit || tried.has(load)) continue;
      tried.add(load);
      loads[bin] += sorted[index].seconds;
      bins[bin].push(index);
      const done = place(index + 1);
      if (done === true) return true;
      bins[bin].pop();
      loads[bin] -= sorted[index].seconds;
      if (done === undefined) return undefined;
    }
    return false;
  };
  const found = place(0);
  return found === true ? bins : found === false ? null : undefined;
}

const loadOf = (sorted, bin) => bin.reduce((sum, index) => sum + sorted[index].seconds, 0);

/** Shortens the longest shard while it can: a unit of it moved to another shard, or swapped for a shorter one, so that neither ends longer than the longest was. Every step lowers the sum of squares, so it ends. */
function even(sorted, bins, limit) {
  const loads = bins.map((bin) => loadOf(sorted, bin));
  for (;;) {
    let longest = 0;
    for (let bin = 1; bin < bins.length; bin += 1) if (loads[bin] > loads[longest]) longest = bin;
    let step = null;
    for (const index of [...bins[longest]].sort((a, b) => byLongest(sorted[a], sorted[b]))) {
      const seconds = sorted[index].seconds;
      for (let other = 0; other < bins.length && step === null; other += 1) {
        if (other === longest) continue;
        if (loads[other] + seconds <= limit && Math.max(loads[longest] - seconds, loads[other] + seconds) < loads[longest]) step = { index, other, back: null };
      }
      if (step !== null) break;
    }
    if (step === null) {
      swaps: for (const index of [...bins[longest]].sort((a, b) => byLongest(sorted[a], sorted[b]))) {
        for (let other = 0; other < bins.length; other += 1) {
          if (other === longest) continue;
          for (const back of [...bins[other]].sort((a, b) => byLongest(sorted[a], sorted[b]))) {
            const delta = sorted[index].seconds - sorted[back].seconds;
            if (delta <= 0) continue;
            if (loads[other] + delta <= limit && Math.max(loads[longest] - delta, loads[other] + delta) < loads[longest]) {
              step = { index, other, back };
              break swaps;
            }
          }
        }
      }
    }
    if (step === null) return bins;
    const { index, other, back } = step;
    bins[longest] = bins[longest].filter((candidate) => candidate !== index);
    bins[other].push(index);
    loads[longest] -= sorted[index].seconds;
    loads[other] += sorted[index].seconds;
    if (back !== null) {
      bins[other] = bins[other].filter((candidate) => candidate !== back);
      bins[longest].push(back);
      loads[other] -= sorted[back].seconds;
      loads[longest] += sorted[back].seconds;
    }
  }
}

const squares = (sorted, bins) => bins.reduce((sum, bin) => sum + loadOf(sorted, bin) ** 2, 0);

/**
 * The shards of `items` (`{ id, seconds }`, whole positive seconds, each at most `limit`): `[{ units, seconds }]`, the fewest there can be under `limit`, as even as that allows, numbered from the longest, the units of a
 * shard longest first. An empty list for no units. A unit over the limit is an error naming it.
 */
export function pack(items, limit, searchBudget = SEARCH_BUDGET) {
  validate(items, limit);
  if (items.length === 0) return [];
  const sorted = [...items].sort(byLongest);
  const fit = firstFit(sorted, limit);

  let chosen = fit;
  const budget = { left: searchBudget };
  for (let count = lowerBound(sorted, limit); count < fit.length; count += 1) {
    const found = search(sorted, count, limit, budget);
    if (found === undefined) break;
    if (found !== null) {
      // The search packs the first shards full; longest-first onto the shortest is the even answer when it fits. Take the one whose longest shard is shorter.
      const spread = longestFirst(sorted, count, limit);
      const options = [even(sorted, found, limit)];
      if (spread !== null) options.push(even(sorted, spread, limit));
      chosen = options.reduce((best, option) => {
        const a = Math.max(...best.map((bin) => loadOf(sorted, bin)));
        const b = Math.max(...option.map((bin) => loadOf(sorted, bin)));
        return b < a || (b === a && squares(sorted, option) < squares(sorted, best)) ? option : best;
      });
      break;
    }
  }
  if (chosen === fit) chosen = even(sorted, fit, limit);

  return chosen
    .filter((bin) => bin.length > 0)
    .map((bin) => ({ units: bin.map((index) => sorted[index]).sort(byLongest), seconds: loadOf(sorted, bin) }))
    .sort((a, b) => b.seconds - a.seconds || byLongest(a.units[0], b.units[0]));
}
