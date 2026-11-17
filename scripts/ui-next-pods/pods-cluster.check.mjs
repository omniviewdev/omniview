// The Pods cluster check (plan docs/ui-next/slices/1a-pods-list.md, PR 1a.1; N19d): the new shell, served by the real Go host from `OMNIVIEW_UI=next` and opened the
// way the native window opens it (no URL parameter, no hash), against a real kind cluster holding the plan's fixture, with the Kubernetes plugin installed from the
// archive of its `feature/ui-next` branch (the plugin's own bundle is the only place the Pods list is written: the host holds no Pods code).
//
//   OMNIVIEW_CHECK_BASE_URL   http://127.0.0.1:<port> of the host under test
//   OMNIVIEW_CHECK_KUBECONFIG the cluster's kubeconfig, for the kubectl oracle
//   OMNIVIEW_CHECK_MODE       parity (default): the page and `kubectl get pods -A` agree, and follow a live change
//                             control-fixture-absent: the check must report FIXTURE_MISSING (cluster without the fixture)
//                             control-plugin-absent:  the check must report PAGE_MISMATCH with no rows (host without the plugin: the kit's empty state of the plugin list)
//                             control-bundle-absent:  the check must report PAGE_MISMATCH with no rows (plugin installed without assets/: "Couldn't load Kubernetes")
//
// The controls run the same `checkParity` and pass only when it fails with the expected code, so a check that has gone blind
// (passing on an empty cluster, a missing plugin or a plugin with no bundle) turns the job red. Run: `node --test scripts/ui-next-pods/pods-cluster.check.mjs`.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { isAgreement, diffNames, ParityError } from './oracle.mjs';
import { checkParity, kubectl, launchBrowser, openPods, oraclePods, settle } from './parity.mjs';

const baseURL = process.env.OMNIVIEW_CHECK_BASE_URL;
const kubeconfig = process.env.OMNIVIEW_CHECK_KUBECONFIG;
const mode = process.env.OMNIVIEW_CHECK_MODE ?? 'parity';
assert.ok(baseURL, 'OMNIVIEW_CHECK_BASE_URL is required');
assert.ok(kubeconfig, 'OMNIVIEW_CHECK_KUBECONFIG is required');
assert.ok(['parity', 'control-fixture-absent', 'control-plugin-absent', 'control-bundle-absent'].includes(mode), `unknown OMNIVIEW_CHECK_MODE ${mode}`);

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
  test('negative control: a host without the Kubernetes plugin fails the check at the list of plugins', async () => {
    const error = await failure({ timeoutMs: 15_000 });
    assert.equal(error.code, 'PAGE_MISMATCH', error.message);
    assert.deepEqual(error.detail.pageNames, [], 'with the plugin absent the page lists no Pods');
    // The window has no plugin to open: the host's own screen says so, in the kit's empty state, under the name of the list of plugins.
    assert.equal(error.detail.read.state, 'empty', error.message);
    assert.match(error.detail.status ?? '', /No Plugins/, 'the page must be stopped at the list of plugins');
  });
} else if (mode === 'control-bundle-absent') {
  test('negative control: the Kubernetes plugin installed without its bundle fails the check at the plugin', async () => {
    const error = await failure({ timeoutMs: 15_000 });
    assert.equal(error.code, 'PAGE_MISMATCH', error.message);
    assert.deepEqual(error.detail.pageNames, [], 'with no bundle the host has no Pods list to draw: it holds none of its own');
    // The plugin's binary is there and the cluster holds the fixture, so the only thing missing is the plugin's interface: the page names the plugin it could not load.
    assert.equal(error.detail.read.state, 'error', error.message);
    assert.match(error.detail.status ?? '', /Couldn't load Kubernetes/, 'the page must be stopped at the plugin');
  });
} else {
  test('the page and kubectl agree on the Pods of every namespace, on their count and on the quick filters', async () => {
    const { oracle, read, expected } = await checkParity({ browser, baseURL, kubeconfig });
    assert.equal(read.state, 'ready', 'the connection is up and the page lists the Pods');
    assert.equal(read.count, `${String(oracle.length)} Pods`, 'the footer counts the same Pods, the whole set');
    assert.deepEqual(read.filters, expected.filters, 'the quick filters count what kubectl says');
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
      assert.equal(appeared.count, `${String(listed.length + 1)} Pods`, 'the footer follows the created Pod');

      await kubectl(kubeconfig, ['delete', 'pod', 'live-probe', '-n', 'checkout', '--grace-period=0', '--force', '--wait=false']);
      const gone = await settle(page, (read) => !read.names.includes(probe), 20_000);
      assert.ok(!gone.names.includes(probe), 'the deleted Pod is still listed');
      assert.equal(gone.count, `${String(listed.length)} Pods`, 'the footer follows the deleted Pod');
      assert.ok(isAgreement(diffNames(gone.names, initial.names)), 'the list is back to the initial Pods');
    } finally {
      await kubectl(kubeconfig, ['delete', 'pod', 'live-probe', '-n', 'checkout', '--ignore-not-found', '--grace-period=0', '--force', '--wait=false']).catch(() => undefined);
      await page.close();
    }
  });
}
