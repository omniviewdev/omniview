import assert from 'node:assert/strict';
import test from 'node:test';
import { chipTexts, diffNames, FIXTURE_PODS, fixtureGaps, isAgreement, parseKubectlPods, parseKubectlTable, quickFilterCounts, quickFilterOf } from './oracle.mjs';

const KUBE_SYSTEM = ['kube-system/coredns-1', 'kube-system/etcd-n', 'kube-system/kube-apiserver-n'];

// A complete fixture cluster: every entry of FIXTURE_PODS, with generated suffixes for the controller-made Pods.
function fixtureCluster() {
  const names = [...KUBE_SYSTEM];
  for (const wanted of FIXTURE_PODS) {
    if (wanted.name !== undefined) {
      names.push(`${wanted.namespace}/${wanted.name}`);
      continue;
    }
    for (let index = 0; index < wanted.count; index += 1) {
      names.push(`${wanted.namespace}/${wanted.prefix}${String(index)}x${String(index)}z`);
    }
  }
  return names.sort();
}

test('parseKubectlPods sorts namespace/name and ignores blank lines', () => {
  const parsed = parseKubectlPods('kube-system   coredns-1\n\nbatch   nightly-report-a\n');
  assert.deepEqual(parsed, ['batch/nightly-report-a', 'kube-system/coredns-1']);
});

test('parseKubectlPods rejects a line that is not two columns', () => {
  assert.throws(() => parseKubectlPods('only-one-column\n'), /unexpected kubectl line/);
  assert.throws(() => parseKubectlPods('a b c\n'), /unexpected kubectl line/);
});

test('fixtureGaps is empty for the complete fixture cluster', () => {
  assert.deepEqual(fixtureGaps(fixtureCluster()), []);
});

// Negative control, first half: a cluster without the fixture (kind's own Pods only) must not satisfy the check.
test('fixtureGaps names every fixture entry when only kube-system Pods exist', () => {
  assert.equal(fixtureGaps(KUBE_SYSTEM).length, FIXTURE_PODS.length);
});

test('fixtureGaps catches a single missing Pod and a short replica count', () => {
  const withoutCrashloop = fixtureCluster().filter((name) => name !== 'checkout/crashloop');
  assert.deepEqual(fixtureGaps(withoutCrashloop), ['checkout/crashloop']);
  const shortCart = fixtureCluster().filter((name) => !name.startsWith('checkout/cart-api-2'));
  assert.deepEqual(fixtureGaps(shortCart), ['checkout/cart-api-*: want 3, found 2']);
});

test('diffNames agrees only on the exact same set', () => {
  const oracle = fixtureCluster();
  assert.equal(isAgreement(diffNames([...oracle], oracle)), true);
});

// Negative control, second half: a page with no rows (plugin absent) disagrees with a populated cluster.
test('diffNames reports every Pod missing from an empty page', () => {
  const oracle = fixtureCluster();
  const diff = diffNames([], oracle);
  assert.deepEqual(diff.missing, oracle);
  assert.equal(isAgreement(diff), false);
});

test('diffNames reports extra and duplicated rows', () => {
  const oracle = ['a/one', 'a/two'];
  const diff = diffNames(['a/one', 'a/one', 'a/three', 'a/two'], oracle);
  assert.deepEqual(diff.extra, ['a/three']);
  assert.deepEqual(diff.duplicated, ['a/one']);
  assert.equal(isAgreement(diff), false);
});

// The page's quick filters are counted from kubectl's own STATUS words, by the plan's rule (docs/ui-next/slices/1a-pods-list.md 1.3).
const TABLE = [
  'checkout   cart-api-1     2/2   Running             0                 51m',
  'checkout   bad-image      0/1   ImagePullBackOff    0                 51m',
  'checkout   crashloop      0/1   CrashLoopBackOff    15 (3m ago)       51m',
  'batch      nightly-1      0/1   Completed           0                 51m',
  'batch      broken-1       0/1   Error               0                 51m',
  'checkout   unschedulable  0/1   Pending             0                 51m',
  'checkout   init-1         0/1   Init:0/1            0                 1m',
  'kube-system coredns-1     1/1   Running             0                 51m',
].join('\n');

test('parseKubectlTable reads name, ready and the printer\'s STATUS word, whatever the RESTARTS column says', () => {
  const rows = parseKubectlTable(TABLE);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.find((row) => row.name === 'checkout/crashloop'), { name: 'checkout/crashloop', ready: '0/1', status: 'CrashLoopBackOff' });
  assert.deepEqual(rows.map((row) => row.name), [...rows.map((row) => row.name)].sort());
});

test('parseKubectlTable rejects a line that is not a table row', () => {
  assert.throws(() => parseKubectlTable('checkout only-two\n'), /unexpected kubectl line/);
  assert.throws(() => parseKubectlTable('a b notaratio Running 0 1m\n'), /unexpected kubectl line/);
});

test('quickFilterOf files each word as the plan says: Running is the word, Pending and Failed are roles, Completed is two words', () => {
  assert.equal(quickFilterOf('Running'), 'running');
  for (const word of ['Pending', 'ContainerCreating', 'PodInitializing', 'Terminating', 'Init:0/1', 'Init:2/3']) assert.equal(quickFilterOf(word), 'pending', word);
  for (const word of ['CrashLoopBackOff', 'Error', 'Failed', 'ImagePullBackOff', 'ErrImagePull', 'OOMKilled', 'Evicted', 'Init:Error', 'Init:CrashLoopBackOff']) assert.equal(quickFilterOf(word), 'failed', word);
  for (const word of ['Completed', 'Succeeded']) assert.equal(quickFilterOf(word), 'completed', word);
  for (const word of ['Unknown', 'Terminated']) assert.equal(quickFilterOf(word), 'other', word);
});

// A word the oracle does not know must stop the check: guessing a filter for it would let the page and the oracle agree on a wrong count.
test('quickFilterOf refuses a STATUS word it cannot classify', () => {
  assert.throws(() => quickFilterOf('SomethingNew'), /cannot classify/);
  assert.throws(() => quickFilterOf('Signal:9'), /cannot classify/);
});

test('quickFilterCounts counts All and each filter over the table', () => {
  assert.deepEqual(quickFilterCounts(parseKubectlTable(TABLE)), { all: 8, running: 2, pending: 2, failed: 3, completed: 1 });
});

test('chipTexts words the counts as the strip prints them, in its order', () => {
  assert.deepEqual(chipTexts({ all: 25, running: 18, pending: 1, failed: 3, completed: 3 }), ['All 25', 'Running 18', 'Pending 1', 'Failed 3', 'Completed 3']);
});
