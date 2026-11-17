// How the page may differ from kubectl and still agree with it (the Pods cluster check). Pure, so `agreement.test.mjs` can prove it without a cluster.
//
// kubectl and the page cannot be read at the same instant, and a Pod of a real cluster can change in between. The fixture's crash-looping Pod (`sh -c "exit 2"`, restarted by
// the kubelet with a back-off) prints `Running` for a second or two after every restart and `CrashLoopBackOff` for the rest of the wait: the first CI run of N19d read kubectl
// once, 0.5 s after such a restart, compared the page against that one reading for 30 s, and failed with Running 19 / Failed 2 against a page that said Running 18 / Failed 3.
// The page was right; the one reading of kubectl was a transient. So:
//
//   - kubectl is read immediately BEFORE and immediately AFTER every reading of the page;
//   - a Pod whose status is the same in both reads must be on the page as kubectl says, in the list, the footer and the quick filters;
//   - a Pod whose status changed between the two reads (or that only one of them lists) may read either way, and only that Pod;
//   - anything else is a mismatch, and the comparison is repeated with fresh reads of both until the page agrees or the deadline passes: never against an old reading.
//
// A persistently wrong page (a Pod kubectl reports the same way before and after, listed or counted another way) never agrees, whatever else flaps.
import { chipTexts, diffNames, isAgreement, quickFilterCounts } from './oracle.mjs';

/** More Pods than this changing between two reads of kubectl is a cluster that is not at rest: the allowance would cover almost any page. */
export const MOST_CHANGING = 6;

/** Splits the two reads into the Pods whose status is the same in both, and the Pods that are not: each with the rows it may be (a row not listed in a read is `undefined`). */
export function changingBetween(before, after) {
  const later = new Map(after.map((row) => [row.name, row]));
  const listedBefore = new Set(before.map((row) => row.name));
  const stable = [];
  const changing = [];
  for (const row of before) {
    const other = later.get(row.name);
    if (other !== undefined && other.status === row.status) {
      stable.push(row);
    } else {
      changing.push({ name: row.name, options: [row, other] });
    }
  }
  for (const row of after) {
    if (!listedBefore.has(row.name)) {
      changing.push({ name: row.name, options: [undefined, row] });
    }
  }
  return { stable, changing };
}

/** Every table kubectl could have printed at the instant of the page's read: the stable Pods, and each changing Pod as it was before or as it was after. */
function* tablesOf(stable, changing) {
  for (let mask = 0; mask < 2 ** changing.length; mask += 1) {
    yield [...stable, ...changing.map((entry, index) => entry.options[(mask >> index) & 1]).filter((row) => row !== undefined)];
  }
}

function problemsAgainst(read, table) {
  const names = table.map((row) => row.name).sort();
  const problems = [];
  const diff = diffNames(read.names, names);
  if (!isAgreement(diff)) {
    problems.push(`the page lists ${String(read.names.length)} Pods, kubectl lists ${String(names.length)} (missing ${String(diff.missing.length)}, extra ${String(diff.extra.length)}, duplicated ${String(diff.duplicated.length)})`);
  }
  const count = `${String(names.length)} Pods`;
  if (read.count !== count) {
    problems.push(`the footer says ${JSON.stringify(read.count)}, kubectl lists ${count}`);
  }
  const filters = chipTexts(quickFilterCounts(table));
  if (JSON.stringify(read.filters) !== JSON.stringify(filters)) {
    problems.push(`the quick filters read ${JSON.stringify(read.filters)}, kubectl says ${JSON.stringify(filters)}`);
  }
  return { problems, matched: { names, count, filters } };
}

/**
 * One reading of the page (`readPage` of parity.mjs) against the two reads of kubectl around it. Returns `{ problems, changing, matched }`: `problems` are readable lines and
 * empty exactly when the page agrees; `changing` are the names of the Pods kubectl changed between its two reads; `matched` is the table the page agrees with.
 */
export function compareReading(read, before, after) {
  if (read.state !== 'ready') {
    return { problems: [`the page is ${read.status}`], changing: [] };
  }
  const { stable, changing } = changingBetween(before, after);
  const changed = changing.map((entry) => entry.name);
  if (changing.length > MOST_CHANGING) {
    return { problems: [`${String(changing.length)} Pods changed between the two reads of kubectl (${changed.join(', ')}): the cluster is not at rest`], changing: changed };
  }
  const own = [];
  if (read.rowCount !== read.names.length) {
    own.push(`the table holds ${String(read.rowCount)} rows and ${String(read.names.length)} are mounted: the window is too small to read it whole`);
  }
  let best;
  for (const table of tablesOf(stable, changing)) {
    const against = problemsAgainst(read, table);
    if (against.problems.length === 0 && own.length === 0) {
      return { problems: [], changing: changed, matched: against.matched };
    }
    if (best === undefined || against.problems.length < best.problems.length) {
      best = against;
    }
  }
  return { problems: [...own, ...best.problems], changing: changed };
}

/**
 * Reads kubectl, the page and kubectl again, and compares, until the page agrees or `timeoutMs` has passed. Every attempt is a whole comparison with fresh reads of both: the
 * only difference it accepts is a Pod kubectl itself changed between its two reads. Returns the last attempt: `{ agreed, attempt, before, after, read, problems, changing, matched }`.
 * `now` and `pause` are the clock and the wait between attempts, for the test.
 */
export async function converge({ kubectl, readPage, timeoutMs, intervalMs = 400, now = Date.now, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const deadline = now() + timeoutMs;
  for (let attempt = 1; ; attempt += 1) {
    const before = await kubectl();
    const read = await readPage();
    const after = await kubectl();
    const result = compareReading(read, before, after);
    const outcome = { attempt, before, after, read, ...result };
    if (result.problems.length === 0) {
      return { agreed: true, ...outcome };
    }
    if (now() >= deadline) {
      return { agreed: false, ...outcome };
    }
    await pause(intervalMs);
  }
}
