import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { podRow, podRowsFromList, stateRole } from './podRows.mjs';

// The oracle is kubectl. `pods-table.golden.json` holds, for every Pod of two responses of a real kube-apiserver v1.35.0 (kind v0.30.0),
// the object and the cells the server printed for it. The corpus files (corpusDirectory) hold `kubectl get pods -A -o json` and the
// matching `kubectl get pods -A --no-headers`; see README.md.

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'pods-table.golden.json'), 'utf8'));
// TABLE_CORPUS_DIR wins; else the first of $TMPDIR/ui1a3-table and /tmp/ui1a3-table that exists (corpus.sh's default is the first).
const corpusDirectory = process.env.TABLE_CORPUS_DIR
  ?? [join(process.env.TMPDIR ?? '/tmp', 'ui1a3-table'), '/tmp/ui1a3-table'].find((directory) => existsSync(directory))
  ?? '/tmp/ui1a3-table';

// Where the data layer and kubectl differ ON PURPOSE (data layer: golden.test.ts of the Kubernetes plugin's `ui/src/pods/data/`, DOCUMENTED, status file 1a.2, E13):
// it counts regular containers only, and a missing restart count is a dash, not 0. Keyed by namespace/name.
const DOCUMENTED = {
  'states/sidecar': { ready: '1/1' }, // kubectl 2/2: it counts the native sidecar, a restartable init container
  'states/init-fail': { restarts: 0 }, // kubectl 3: it counts the init container's restarts while the Pod initialises
};

const UNITS = { y: 365 * 86400, d: 86400, h: 3600, m: 60, s: 1 };

/** kubectl's AGE for a Pod created at `createdMs` when the server's clock reads `nowSeconds`: `HumanDuration` of k8s.io/apimachinery/pkg/util/duration. */
export function kubectlAge(createdMs, nowSeconds) {
  const seconds = nowSeconds - Math.floor(createdMs / 1000);
  if (seconds < -1) {
    return '<invalid>';
  }

  if (seconds < 0) {
    return '0s';
  }

  if (seconds < 120) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 10) {
    return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m${seconds % 60}s`;
  }

  if (minutes < 180) {
    return `${minutes}m`;
  }

  const hours = Math.floor(seconds / 3600);
  if (hours < 8) {
    return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`;
  }

  if (hours < 48) {
    return `${hours}h`;
  }

  if (hours < 24 * 8) {
    return hours % 24 === 0 ? `${hours / 24}d` : `${Math.floor(hours / 24)}d${hours % 24}h`;
  }

  if (hours < 24 * 365 * 2) {
    return `${Math.floor(hours / 24)}d`;
  }

  if (hours < 24 * 365 * 8) {
    const days = Math.floor(hours / 24) % 365;
    return days === 0 ? `${Math.floor(hours / 24 / 365)}y` : `${Math.floor(hours / 24 / 365)}y${days}d`;
  }

  return `${Math.floor(hours / 24 / 365)}y`;
}

/** The span of ages a printed label can stand for: "8m19s" is [499, 500), "5h" at least 18000 and less than 21600. Loose on purpose; `matchingInstant` is exact. */
function labelSpan(label) {
  const parts = [...label.matchAll(/(\d+)([ydhms])/g)];
  const low = parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNITS[unit], 0);
  return [low, low + UNITS[parts.at(-1)[2]]];
}

/**
 * The second at which the server read its clock, found from the labels alone: a second at which `kubectlAge` gives the printed label for
 * every Pod. Returns undefined when there is none. The rows hold the instant (`createdAt`); kubectl prints a label of it.
 * @param {Array<{ createdAt: number | undefined }>} rows
 * @param {string[]} labels
 */
export function matchingInstant(rows, labels) {
  let low = -Infinity;
  let high = Infinity;
  rows.forEach((row, index) => {
    const [from, to] = labelSpan(labels[index]);
    const created = Math.floor(row.createdAt / 1000);
    low = Math.max(low, created + from);
    high = Math.min(high, created + to);
  });
  for (let now = low; now < high; now++) {
    if (rows.every((row, index) => kubectlAge(row.createdAt, now) === labels[index])) {
      return now;
    }
  }

  return undefined;
}

/**
 * Every field the oracle prints, compared with the row's; returns one line per difference.
 * @param {object[]} objects The Pod objects.
 * @param {Array<{ ready: string, status: string, restarts: string, age: string }>} printed What kubectl printed, same order.
 */
function differences(objects, printed) {
  const rows = objects.map(podRow);
  const lines = [];
  rows.forEach((row, index) => {
    const id = `${row.namespace}/${row.name}`;
    const documented = DOCUMENTED[id];
    const expected = printed[index];
    const ready = row.ready === undefined ? undefined : `${row.ready.ready}/${row.ready.total}`;
    if (ready !== (documented?.ready ?? expected.ready)) {
      lines.push(`${id}: Ready ${ready} (kubectl ${expected.ready})`);
    }

    if (row.status?.word !== expected.status) {
      lines.push(`${id}: Status ${row.status?.word} (kubectl ${expected.status})`);
    }

    // kubectl prints 0 for a Pod with no container status yet; the row says undefined (plan E4). Anything else must be the printed number.
    const printedRestarts = Number.parseInt(expected.restarts, 10);
    const noStatus = objects[index].status?.containerStatuses === undefined;
    const wanted = noStatus ? undefined : documented !== undefined && 'restarts' in documented ? documented.restarts : printedRestarts;
    if (noStatus && printedRestarts !== 0) {
      lines.push(`${id}: no container status but kubectl prints ${printedRestarts} restarts`);
    }

    if (row.restarts !== wanted) {
      lines.push(`${id}: Restarts ${row.restarts} (kubectl ${expected.restarts})`);
    }
  });

  return lines;
}

// ---- always: the recorded responses of a real API server ----

for (const capture of golden.captures) {
  test(`kubectl oracle, golden capture "${capture.label}": Ready, Status, Restarts, Age of every Pod`, () => {
    const cell = (cells, name) => cells[capture.columns.indexOf(name)];
    const printed = capture.rows.map(({ cells }) => ({ ready: cell(cells, 'Ready'), status: cell(cells, 'Status'), restarts: cell(cells, 'Restarts'), age: cell(cells, 'Age') }));
    const objects = capture.rows.map(({ object }) => object);

    assert.deepEqual(differences(objects, printed), []);

    const rows = objects.map(podRow);
    const now = matchingInstant(rows, printed.map(({ age }) => age));
    assert.notEqual(now, undefined, 'no instant makes every Age label equal to the label of its createdAt');
    // The server's own Date header is the second the response was written: within two seconds of the instant its clock read.
    const served = Date.parse(capture.serverDate.trim()) / 1000;
    assert.ok(Math.abs(now - served) <= 2, `the instant ${now} is ${now - served} s from the server date ${capture.serverDate.trim()}`);
  });
}

test('golden rows: key, nodes, addresses and the roles of the printed words', () => {
  const rows = golden.captures[1].rows.map(({ object }) => podRow(object));
  const byName = new Map(rows.map((row) => [`${row.namespace}/${row.name}`, row]));

  assert.deepEqual(rows.map((row) => row.key), golden.captures[1].rows.map(({ object }) => object.metadata.uid));
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  const crash = byName.get('checkout/crashloop');
  assert.deepEqual(crash.status, { word: 'CrashLoopBackOff', role: 'error' });
  assert.equal(crash.restarts, 6);
  assert.deepEqual(byName.get('checkout/cart-api-86bf766589-78whc').ready, { ready: 2, total: 2 });
  assert.deepEqual(byName.get('states/terminating').status, { word: 'Terminating', role: 'progress' });
  assert.deepEqual(byName.get('states/init-wait').status, { word: 'Init:0/1', role: 'progress' });
  assert.deepEqual(byName.get('states/init-fail').status, { word: 'Init:Error', role: 'error' });
  assert.deepEqual(byName.get('batch/nightly-report-mdxcg').status, { word: 'Completed', role: 'healthy' });
  // A Pod that is not scheduled has no node and no address, and no container status: undefined, never 0 or an empty string.
  const pending = byName.get('checkout/unschedulable');
  assert.deepEqual([pending.node, pending.ip, pending.restarts], [undefined, undefined, undefined]);
  assert.deepEqual(pending.ready, { ready: 0, total: 1 });
  assert.equal(byName.get('checkout/cart-api-86bf766589-78whc').nameTail, '-78whc'.length);
  assert.equal(byName.get('checkout/cart-cache-0').nameTail, '-0'.length);
  assert.equal(typeof crash.createdAt, 'number');
});

test('stateRole is the data layer table', () => {
  assert.equal(stateRole('Running'), 'running');
  assert.equal(stateRole('Init:3/5'), 'progress');
  assert.equal(stateRole('Init:OOMKilled'), 'error');
  assert.equal(stateRole('Init:Nonsense'), 'error');
  assert.equal(stateRole('ExitCode:2'), 'error');
  assert.equal(stateRole('SchedulingGated'), undefined);
  assert.equal(stateRole(undefined), undefined);
});

test('kubectlAge follows HumanDuration across its unit changes', () => {
  const at = (seconds) => kubectlAge(0, seconds);
  assert.deepEqual([at(-1), at(0), at(119)], ['0s', '0s', '119s']);
  assert.deepEqual([at(120), at(372), at(540), at(599), at(600)], ['2m', '6m12s', '9m', '9m59s', '10m']);
  assert.deepEqual([at(3 * 3600 - 1), at(3 * 3600), at(7 * 3600 + 120)], ['179m', '3h', '7h2m']);
  assert.deepEqual([at(8 * 3600 + 59), at(47 * 3600), at(48 * 3600), at(50 * 3600), at(8 * 86400), at(2 * 365 * 86400 + 86400)], ['8h', '47h', '2d', '2d2h', '8d', '2y1d']);
});

test('a row is undefined where the object holds nothing, and a list must be a list', () => {
  const row = podRow({ metadata: { name: 'x-abc12', uid: 'u1' } });
  assert.deepEqual(row, { key: 'u1', name: 'x-abc12', namespace: '', nameTail: 6, ready: undefined, status: undefined, restarts: undefined, createdAt: undefined, node: undefined, ip: undefined });
  assert.deepEqual(podRowsFromList({ items: [] }), []);
  assert.throws(() => podRowsFromList({}), /expected a PodList/);
  assert.throws(() => podRowsFromList(null), /expected a PodList/);
});

// ---- when the corpus exists: the kind cluster's Pods at 25 / 1,025 / 5,025 ----

/** The printed columns of `kubectl get pods -A --no-headers`: NAMESPACE NAME READY STATUS RESTARTS AGE; RESTARTS may read `3 (57s ago)`. */
function parseKubectlText(file) {
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => {
    const match = /^(\S+)\s+(\S+)\s+(\d+\/\d+)\s+(\S+)\s+(\d+)(?: \([^)]*\))?\s+(\S+)$/.exec(line.trim());
    assert.ok(match, `a line of kubectl text that does not parse: ${line}`);
    const [, namespace, name, ready, status, restarts, age] = match;
    return { namespace, name, ready, status, restarts, age };
  });
}

const SIZES = [
  ['fixture', 25],
  ['1025', 1025],
  ['5025', 5025],
];

for (const [label, expectedCount] of SIZES) {
  const json = join(corpusDirectory, `pods-${label}.json`);
  const text = join(corpusDirectory, `pods-${label}.kubectl.txt`);
  const missing = [json, text].filter((file) => !existsSync(file));
  const skip = missing.length > 0 ? `corpus file missing: ${missing.join(', ')} (run bench/table/corpus/corpus.sh, or set TABLE_CORPUS_DIR)` : false;

  test(`kubectl oracle, corpus pods-${label}: Ready, Status, Restarts and Age of every Pod`, { skip }, () => {
    const list = JSON.parse(readFileSync(json, 'utf8'));
    const rows = podRowsFromList(list);
    const lines = parseKubectlText(text);

    assert.equal(rows.length, expectedCount, `the corpus holds ${rows.length} Pods, expected ${expectedCount}`);
    assert.equal(lines.length, rows.length, 'kubectl printed another number of Pods than the list holds');
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length, 'a uid is used twice');

    // The two kubectl calls ran a moment apart: join by namespace and name, which are unique among live Pods.
    const printedBy = new Map(lines.map((line) => [`${line.namespace}/${line.name}`, line]));
    assert.equal(printedBy.size, lines.length, 'kubectl printed a namespace/name twice');
    const printed = list.items.map((item) => {
      const line = printedBy.get(`${item.metadata.namespace}/${item.metadata.name}`);
      assert.ok(line, `kubectl did not print ${item.metadata.namespace}/${item.metadata.name}`);
      return line;
    });

    assert.deepEqual(differences(list.items, printed).slice(0, 20), []);
    const now = matchingInstant(rows, printed.map(({ age }) => age));
    assert.notEqual(now, undefined, 'no instant makes every Age label equal to the label of its createdAt');
  });
}
