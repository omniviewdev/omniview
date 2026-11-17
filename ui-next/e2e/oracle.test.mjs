import assert from 'node:assert/strict';
import test from 'node:test';
import { diffNames, FIXTURE_PODS, fixtureGaps, isAgreement, parseKubectlPods } from './oracle.mjs';

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
