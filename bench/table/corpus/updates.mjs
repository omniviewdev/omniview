// The seeded sparse live-update workload of bench/render/fixtures/updates.ts, at the row level: pure, deterministic, no timers.
//
// A host source view in snapshot-and-updates mode delivers a few records per event, drawn from the whole list, so most updates land off
// screen. Here one `apply(rows)` is one event. The caller schedules it (every 1000 / eventsPerSecond ms) and feeds the returned rows to
// the table. A seed and four numbers fully determine which Pods change, how, and in what order; the next call continues the sequence.
//
// Touches are counted from 1 across events, as in updates.ts:
//   - every `recreateEvery`-th touch deletes the Pod and appends a new incarnation: same name and namespace, new key, createdAt + 1 h,
//     0 restarts, Running (the host's source view appends a record it has not seen, so the row goes to the end of the array);
//   - an even touch is a restart: restarts + 1;
//   - an odd touch is a phase flip: Running <-> Pending, Ready all <-> 0, and the role of the new word.
// Rows that are not touched keep their object identity.

import { stateRole } from './podRows.mjs';

/** Small seeded PRNG (mulberry32) so every run sees the same data. Copied from bench/render/fixtures/kubernetes.ts (`rng`). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RECREATED_AFTER_MS = 3_600_000;

const hex = (rand, length) => Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join('');
const uid = (rand) => `${hex(rand, 8)}-${hex(rand, 4)}-${hex(rand, 4)}-${hex(rand, 4)}-${hex(rand, 12)}`;

const status = (word) => ({ word, role: stateRole(word) });

/** Restarts + 1. */
function restarted(row) {
  return { ...row, restarts: (row.restarts ?? 0) + 1 };
}

/** Running <-> Pending with the Ready count that goes with each. */
function phaseFlipped(row) {
  const running = row.status?.word !== 'Running';
  const total = row.ready?.total ?? 1;
  return { ...row, status: status(running ? 'Running' : 'Pending'), ready: { ready: running ? total : 0, total } };
}

/** The same name and namespace as a new incarnation: new key, created an hour later, no restarts, Running. */
function recreated(row, rand) {
  const total = row.ready?.total ?? 1;
  return {
    ...row,
    key: uid(rand),
    createdAt: row.createdAt === undefined ? undefined : row.createdAt + RECREATED_AFTER_MS,
    restarts: 0,
    status: status('Running'),
    ready: { ready: total, total },
  };
}

/**
 * Validate the schedule.
 * @throws {Error} For a non-finite or non-positive event rate, a non-positive or non-integer batch size, a negative or non-integer
 * recreation interval, or a non-integer seed.
 */
function validate({ eventsPerSecond, recordsPerEvent, recreateEvery, seed }) {
  if (!Number.isFinite(eventsPerSecond) || eventsPerSecond <= 0) throw new Error('eventsPerSecond must be a positive number');
  if (!Number.isInteger(recordsPerEvent) || recordsPerEvent < 1) throw new Error('recordsPerEvent must be a positive integer');
  if (!Number.isInteger(recreateEvery) || recreateEvery < 0) throw new Error('recreateEvery must be a non-negative integer');
  if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
}

/**
 * @param {{ eventsPerSecond?: number, recordsPerEvent?: number, recreateEvery?: number, seed?: number }} [spec]
 *   `eventsPerSecond` is validated and kept for the record; the caller owns the clock. `recreateEvery` 0 turns recreation off.
 * @returns {{ apply(rows: readonly object[]): { rows: object[], touched: Array<{ kind: 'restart' | 'phase' | 'recreate', key: string, previousKey: string }>, removed: number, added: number } }}
 *   `apply` returns a new array: the same row objects except the replaced ones, in the same positions; recreated rows go to the end.
 *   `touched` lists the Pods of the event in draw order with the key they have now; `removed` and `added` count the recreated Pods.
 * @throws {Error} From `createUpdates` for an invalid spec; from `apply` when the event touches more Pods than the rows hold.
 */
export function createUpdates({ eventsPerSecond = 5, recordsPerEvent = 2, recreateEvery = 10, seed = 1 } = {}) {
  validate({ eventsPerSecond, recordsPerEvent, recreateEvery, seed });
  const rand = rng(seed);
  let touches = 0;

  return {
    apply(rows) {
      if (recordsPerEvent > rows.length) {
        throw new Error('recordsPerEvent exceeds the rows');
      }

      const chosen = new Set();
      while (chosen.size < recordsPerEvent) {
        chosen.add(Math.floor(rand() * rows.length));
      }

      const next = rows.slice();
      const touched = [];
      const appended = [];
      const deleted = new Set();
      for (const index of chosen) {
        const row = rows[index];
        touches++;
        if (recreateEvery > 0 && touches % recreateEvery === 0) {
          const replacement = recreated(row, rand);
          deleted.add(index);
          appended.push(replacement);
          touched.push({ kind: 'recreate', key: replacement.key, previousKey: row.key });
        } else {
          const replacement = touches % 2 === 0 ? restarted(row) : phaseFlipped(row);
          next[index] = replacement;
          touched.push({ kind: touches % 2 === 0 ? 'restart' : 'phase', key: replacement.key, previousKey: row.key });
        }
      }

      const kept = deleted.size === 0 ? next : next.filter((_, index) => !deleted.has(index));
      return { rows: kept.concat(appended), touched, removed: deleted.size, added: appended.length };
    },
  };
}
