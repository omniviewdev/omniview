// The Pods cluster check (plan docs/ui-next/slices/1a-pods-list.md, PR 1a.1; N19d): the new shell, served by the real Go host from `OMNIVIEW_UI=next` and opened the
// way the native window opens it for a first run (no URL parameter, no hash, nothing saved: the window is empty, S3a), the Kubernetes plugin opened from the window's list of plugins as a person
// opens it, against a real kind cluster holding the plan's fixture, with the Kubernetes plugin installed from the
// archive of its `feature/ui-next` branch (the plugin's own bundle is the only place the Pods list is written: the host holds no Pods code).
//
//   OMNIVIEW_CHECK_BASE_URL   http://127.0.0.1:<port> of the host under test
//   OMNIVIEW_CHECK_KUBECONFIG the cluster's kubeconfig, for the kubectl oracle
//   OMNIVIEW_CHECK_MODE       parity (default): the page and `kubectl get pods -A` agree, and follow a live change; the Pod detail page opened from the list prints what kubectl says; the Logs command of a Pod
//                             opens a session in the Logs tool with the lines `kubectl logs --timestamps` prints, and closing its tab closes the SDK's session; pressed twice on a running Pod it shows its one session (A22)
//                             control-fixture-absent: the check must report FIXTURE_MISSING (cluster without the fixture)
//                             control-plugin-absent:  the check must report PAGE_MISMATCH with no rows (host without the plugin: the kit's empty state of the plugin list)
//                             control-bundle-absent:  the check must report PAGE_MISMATCH with no rows (plugin installed without assets/: "Couldn't load Kubernetes"), and the failure must be found from the empty
//                                                     window's rail: an entry "Kubernetes, did not load" whose tip says why and whose choice opens the page that names it
//
// The controls run the same `checkParity` and pass only when it fails with the expected code, so a check that has gone blind
// (passing on an empty cluster, a missing plugin or a plugin with no bundle) turns the job red. Run: `node --test scripts/ui-next-pods/pods-cluster.check.mjs`.
//
// H6 (plugin PR #272): a connection's ID is derived (`<slug>-<10 hex>`) and differs on every run, because the kubeconfig of the check lives in a temporary directory. The check never writes one down: the first test
// reads the ID from the host's list of connections and holds the scope lane to the NAME (the context kubectl calls current), lane.mjs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { isAgreement, diffNames, ParityError } from './oracle.mjs';
import { checkCounts, checkDetail, checkLogs, checkLogsTwice, checkParity, expectedLane, kubectl, launchBrowser, openPods, openWindow, oraclePods, settle } from './parity.mjs';
import { compareLane } from './lane.mjs';
import { compareTabName } from './logs.mjs';

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

    // A window with nothing saved opens empty, so a failure that only a page names would never be seen: the plugin is in the rail too, named for what happened, with the cause in its tip (what a hover or a
    // focus shows), and choosing its entry opens the page that names the failure. Nothing else of the window is opened first.
    const page = await openWindow(browser, baseURL);
    try {
      const entry = page.getByRole('group', { name: 'Plugins' }).getByRole('button', { name: 'Kubernetes, did not load' });
      await entry.waitFor({ timeout: 20_000 });
      assert.match((await entry.getAttribute('data-ov-tip')) ?? '', /^Kubernetes, did not load\n.+/, 'the entry says why in its tip');
      assert.equal(await page.getByRole('tab').count(), 0, 'the window opened no page by itself');
      await entry.click();
      const alert = page.getByRole('alert').filter({ hasText: 'Couldn\'t load Kubernetes' });
      await alert.first().waitFor({ timeout: 20_000 });
      assert.equal(await page.getByRole('tab').count(), 1, 'the page the entry opens is a tab of its own');
    } finally {
      await page.close();
    }
  });
} else {
  test('the page and kubectl agree on the Pods of every namespace, on their count and on the quick filters', async () => {
    const { oracle, read, expected } = await checkParity({ browser, baseURL, kubeconfig });
    assert.equal(read.state, 'ready', 'the connection is up and the page lists the Pods');
    assert.equal(read.count, `${String(oracle.length)} Pods`, 'the footer counts the same Pods, the whole set');
    assert.deepEqual(read.filters, expected.filters, 'the quick filters count what kubectl says');
    // The one assertion about the connection's chip (H6): its text is the NAME of the connection, and not the ID that the host lists for it.
    const lane = compareLane(read.lane, await expectedLane({ baseURL, kubeconfig }));
    assert.equal(lane.length, 0, lane.join('; '));
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

  // The sidebar's counts (Q2): the kinds on screen (the Workloads group, which holds the page on screen, and the top level) say the number `kubectl get <kind> -A --no-headers | wc -l` says, the open kind exactly and a
  // kind of none or one exactly (counts.mjs, with its controls). Parity mode only: the controls stop before any Pod is listed.
  test('the sidebar counts the kinds on screen as kubectl does', async () => {
    const { rows, expected } = await checkCounts({ browser, baseURL, kubeconfig });
    assert.ok(rows.length >= Object.keys(expected).length, `the sidebar lists the counted kinds: ${JSON.stringify(rows)}`);
  });

  // The Pod detail page the list links to (the plugin's `kubernetes/pod` page): opened by the click on the Pod's name, it prints what `kubectl get pod -o json` says
  // (detail.mjs). Parity mode only: the controls stop before any Pod is listed.
  test('the Pod detail page, opened from the list, prints the name, node, Pod IP, host IP and QoS class kubectl says', async () => {
    const { read, expected } = await checkDetail({ browser, baseURL, kubeconfig });
    assert.equal(read.h1, expected.name);
  });

  // The first real log stream of the new stack (P1b-3b): the Logs command of a Pod's page opens a session in the host's Logs tool, whose rows are the lines `kubectl logs --timestamps` prints, and closing its tab
  // closes the SDK's session (logs.mjs). Parity mode only. The Pod is a finished Job's: its stream ends at once. P1b-3d (A22, SCT1): a session alone in the tool draws no scope (no `<pod> · <connection>`), and a tab's
  // accessible name carries the state of a session that is not running, so the tab reads `<pod>, ended`: both parts are asserted, as the one exact name (compareTabName, with its controls in logs.test.mjs).
  test('the Logs command of a Pod opens a session with the lines kubectl logs prints, and closing its tab closes the SDK session', async () => {
    const { read, pod } = await checkLogs({ browser, baseURL, kubeconfig });
    assert.ok(read.rows.length > 0, 'the session has lines');
    assert.deepEqual(compareTabName(read.tabs[0], pod.name, 'ended'), [], `the session's tab is named for the Pod, then its state: ${JSON.stringify(read.tabs)}`);
  });

  // P1b-3d (A22: a session is its plugin and its target): the Logs command of a RUNNING Pod, pressed twice, shows its one session: one tab, named for the Pod, one SDK session more and not two (logs.mjs, `compareRepress`,
  // with its controls in logs.test.mjs; parity.mjs, `checkLogsTwice`). The first proof of a re-activation against a real cluster. Parity mode only; last, because it makes a Pod of its own.
  test('the Logs command of a running Pod pressed twice shows its one session: one tab, one SDK session', async () => {
    const { found } = await checkLogsTwice({ browser, baseURL, kubeconfig });
    assert.equal(found.second.tabs.length, 1, 'the second press shows the session, it opens no other');
  });
}
