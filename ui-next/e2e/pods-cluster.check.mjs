// The Pods cluster check (plan docs/ui-next/slices/1a-pods-list.md, PR 1a.1): the new tree's `?screen=pods` page, served by the real
// Go host from `OMNIVIEW_UI=next`, against a real kind cluster holding the plan's fixture, with the Kubernetes plugin installed.
//
//   OMNIVIEW_CHECK_BASE_URL   http://127.0.0.1:<port> of the host under test
//   OMNIVIEW_CHECK_KUBECONFIG the cluster's kubeconfig, for the kubectl oracle
//   OMNIVIEW_CHECK_MODE       parity (default): the page and `kubectl get pods -A` agree, and follow a live change
//                             control-fixture-absent: the check must report FIXTURE_MISSING (cluster without the fixture)
//                             control-plugin-absent:  the check must report PAGE_MISMATCH with no rows (host without the plugin)
//
// The controls run the same `checkParity` and pass only when it fails with the expected code, so a check that has gone blind
// (passing on an empty cluster or a missing plugin) turns the job red. Run: `node --test ui-next/e2e/pods-cluster.check.mjs`.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { isAgreement, diffNames, ParityError } from './oracle.mjs';
import { checkParity, kubectl, launchBrowser, openPods, oraclePods, settle } from './parity.mjs';

const baseURL = process.env.OMNIVIEW_CHECK_BASE_URL;
const kubeconfig = process.env.OMNIVIEW_CHECK_KUBECONFIG;
const mode = process.env.OMNIVIEW_CHECK_MODE ?? 'parity';
assert.ok(baseURL, 'OMNIVIEW_CHECK_BASE_URL is required');
assert.ok(kubeconfig, 'OMNIVIEW_CHECK_KUBECONFIG is required');
assert.ok(['parity', 'control-fixture-absent', 'control-plugin-absent'].includes(mode), `unknown OMNIVIEW_CHECK_MODE ${mode}`);

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

async function failure(options) {
  try {
    await checkParity({ browser, baseURL, kubeconfig, ...options });
  } catch (error) {
    assert.ok(error instanceof ParityError, `the check failed for a reason other than a detected defect: ${String(error)}`);
    return error;
  }
  return assert.fail('the check passed where it must fail: the negative control is blind');
}

if (mode === 'control-fixture-absent') {
  test('negative control: a cluster without the fixture fails the check', async () => {
    const error = await failure();
    assert.equal(error.code, 'FIXTURE_MISSING', error.message);
  });
} else if (mode === 'control-plugin-absent') {
  test('negative control: a host without the Kubernetes plugin fails the check at the connection', async () => {
    const error = await failure({ timeoutMs: 15_000 });
    assert.equal(error.code, 'PAGE_MISMATCH', error.message);
    assert.deepEqual(error.detail.pageNames, [], 'with the plugin absent the page lists no Pods');
    assert.match(error.detail.status ?? '', /No connections|Loading connections/, 'the page must be stopped at the connection');
  });
} else {
  test('the page and kubectl agree on the Pods of every namespace', async () => {
    const { oracle, status } = await checkParity({ browser, baseURL, kubeconfig });
    assert.match(status ?? '', /connected/, 'the connection is up');
    assert.match(status ?? '', new RegExp(`\\b${String(oracle.length)} pods\\b`), 'the page counts the same Pods');
  });

  // The runtime's live feed, end to end: a Pod created and deleted with kubectl appears and disappears without a reload.
  test('the page follows a Pod created and deleted with kubectl', async () => {
    const probe = 'checkout/live-probe';
    const page = await openPods(browser, baseURL);
    try {
      const listed = await oraclePods(kubeconfig);
      const initial = await settle(page, (read) => isAgreement(diffNames(read.names, listed)), 30_000);
      assert.ok(!initial.names.includes(probe), 'the probe Pod must not exist before the test');

      await kubectl(kubeconfig, ['run', 'live-probe', '-n', 'checkout', '--image=busybox:1.37.0', '--restart=Never', '--', 'sleep', '3600']);
      const appeared = await settle(page, (read) => read.names.includes(probe), 20_000);
      assert.ok(appeared.names.includes(probe), `the created Pod did not appear; page status ${JSON.stringify(appeared.status)}`);

      await kubectl(kubeconfig, ['delete', 'pod', 'live-probe', '-n', 'checkout', '--grace-period=0', '--force', '--wait=false']);
      const gone = await settle(page, (read) => !read.names.includes(probe), 20_000);
      assert.ok(!gone.names.includes(probe), 'the deleted Pod is still listed');
      assert.ok(isAgreement(diffNames(gone.names, initial.names)), 'the list is back to the initial Pods');
    } finally {
      await kubectl(kubeconfig, ['delete', 'pod', 'live-probe', '-n', 'checkout', '--ignore-not-found', '--grace-period=0', '--force', '--wait=false']).catch(() => undefined);
      await page.close();
    }
  });
}
