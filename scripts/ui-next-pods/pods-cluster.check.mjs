// The Pods cluster check (plan docs/ui-next/slices/1a-pods-list.md, PR 1a.1; N19d): the new shell, served by the real Go host from `OMNIVIEW_UI=next` and opened the
// way the native window opens it for a first run (no URL parameter, no hash, nothing saved: the window is empty, S3a), the Kubernetes plugin opened from the window's list of plugins as a person
// opens it (it lands on the connection's Overview, HM3, and the Pods list is one choice away in the sidebar), against a real kind cluster holding the plan's fixture, with the Kubernetes plugin installed from the
// archive of its `feature/ui-next` branch (the plugin's own bundle is the only place the Overview and the Pods list are written: the host holds no Pods code).
//
//   OMNIVIEW_CHECK_BASE_URL   http://127.0.0.1:<port> of the host under test
//   OMNIVIEW_CHECK_KUBECONFIG the cluster's kubeconfig, for the kubectl oracle
//   OMNIVIEW_CHECK_MODE       parity (default): the Overview the plugin lands on says what kubectl says (HM3c, plugin #287: the connection's name, Needs attention, the Workloads table, the Cluster rows, and no zero in any frame while it loads: overview.mjs); the Pods list, opened from the Overview through the sidebar, and `kubectl get pods -A` agree, and follow a live change; the Pod detail page opened from the list prints what kubectl says; the generic detail page of a Deployment (K2c-2) opened from the Deployments list prints its Details rows as kubectl says, and one deleted while its page is open is titled "was deleted"; the Logs command of a Pod
//                             opens a session in the Logs tool with the lines `kubectl logs --timestamps` prints, and closing its tab closes the SDK's session; pressed twice on a running Pod it shows its one session (A22)
//                             a press on a column header sorts a list (K3a): the Pods list by Restarts and the Deployments list by Age, twice each, against `kubectl get <kind> -A -o json` (sort.mjs)
//                             a Pod that declares a port offers Forward port in its page's menu (PF3-k8s, plugin #288), and the forward started from it is listed in the Ports tool as `localhost:<port> → :8080/TCP`, the host the plugin states (parity.mjs, `checkForward`)
//                             control-fixture-absent: both checks, the Pods list's and the Overview's, must report FIXTURE_MISSING (cluster without the fixture)
//                             control-plugin-absent:  the Pods check must report PAGE_MISMATCH with no rows and the Overview check OVERVIEW_MISMATCH with no tab (host without the plugin: the kit's empty state of the plugin list)
//                             control-bundle-absent:  the Pods check must report PAGE_MISMATCH with no rows and the Overview check OVERVIEW_MISMATCH with no section (plugin installed without assets/: "Couldn't load Kubernetes"), and the failure must be found from the empty
//                                                     window's rail: an entry "Kubernetes, did not load" whose tip says why and whose choice opens the page that names it
//                             unavailable-group:      INV4 (plugin #281): the host started AFTER an API group that cannot answer was registered (an APIService whose Service has no endpoints: unavailable-group.yaml, applied by the workflow before the host starts): the plugin's page opens from the list of plugins and lists the Pods with no press on Retry, no request the host refused, and the connection's facts name the group (unavailable.mjs)
//                             control-group-absent:   the check must report GROUP_MISSING (the cluster the main check ran on, which holds no such group)
//
// The controls run the same `checkParity` and `checkOverview` and pass only when each fails with the expected code, so a check that has gone blind
// (passing on an empty cluster, a missing plugin or a plugin with no bundle) turns the job red. Run: `node --test scripts/ui-next-pods/pods-cluster.check.mjs`.
//
// H6 (plugin PR #272): a connection's ID is derived (`<slug>-<10 hex>`) and differs on every run, because the kubeconfig of the check lives in a temporary directory. The check never writes one down: the first test
// reads the ID from the host's list of connections and holds the scope lane to the NAME (the context kubectl calls current), lane.mjs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { isAgreement, diffNames, ParityError } from './oracle.mjs';
import { checkCounts, checkDeploymentDetail, checkDeploymentGone, checkDetail, checkForward, checkLogs, checkLogsRate, checkLogsTwice, checkOverview, checkParity, checkSort, checkUnavailableGroup, expectedLane, kubectl, launchBrowser, openPods, openWindow, oraclePods, settle } from './parity.mjs';
import { compareDrawn, compareLane, readDrawn } from './lane.mjs';
import { compareTabName } from './logs.mjs';
import { compareFacts } from './unavailable.mjs';
import { opposite } from './sort.mjs';

const baseURL = process.env.OMNIVIEW_CHECK_BASE_URL;
const kubeconfig = process.env.OMNIVIEW_CHECK_KUBECONFIG;
const mode = process.env.OMNIVIEW_CHECK_MODE ?? 'parity';
assert.ok(baseURL, 'OMNIVIEW_CHECK_BASE_URL is required');
assert.ok(kubeconfig, 'OMNIVIEW_CHECK_KUBECONFIG is required');
assert.ok(['parity', 'control-fixture-absent', 'control-plugin-absent', 'control-bundle-absent', 'control-group-absent', 'unavailable-group'].includes(mode), `unknown OMNIVIEW_CHECK_MODE ${mode}`);

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

async function failure(options, check = checkParity) {
  try {
    await check({ browser, baseURL, kubeconfig, ...options });
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
  // An Overview of an empty cluster agrees with kubectl too (every count is kind's own), so a check that does not stop at the fixture is blind here.
  test('negative control: a cluster without the fixture fails the Overview check too', async () => {
    const error = await failure({}, checkOverview);
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
  test('negative control: a host without the Kubernetes plugin has no Overview to read: the Overview check fails at the list of plugins', async () => {
    const error = await failure({ timeoutMs: 15_000 }, checkOverview);
    assert.equal(error.code, 'OVERVIEW_MISMATCH', error.message);
    assert.equal(error.detail.pressed, false, 'the window has no row for the plugin to press');
    assert.deepEqual(error.detail.overview.tabs, [], 'no page opened');
    assert.deepEqual(error.detail.overview.sections, [], 'with the plugin absent the page draws no section');
    assert.equal(error.detail.page.state, 'empty', error.message);
    assert.match(error.detail.page.status ?? '', /No Plugins/, 'the page must be stopped at the list of plugins');
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
  test('negative control: the Kubernetes plugin installed without its bundle has no Overview to read: the Overview check fails at the plugin', async () => {
    const error = await failure({ timeoutMs: 15_000 }, checkOverview);
    assert.equal(error.code, 'OVERVIEW_MISMATCH', error.message);
    assert.equal(error.detail.pressed, true, 'the plugin\'s row is there, and opens the page that names the failure');
    assert.deepEqual(error.detail.overview.sections, [], 'with no bundle the host has no Overview to draw: it holds none of its own');
    assert.equal(error.detail.page.state, 'error', error.message);
    assert.match(error.detail.page.status ?? '', /Couldn't load Kubernetes/, 'the page must be stopped at the plugin');
  });
} else if (mode === 'control-group-absent') {
  // The same check, on the cluster the main check ran on: no API group that cannot answer is registered, so the check must stop at the group before it opens a page, as FIXTURE_MISSING does for the fixture.
  test('negative control: a cluster without the API group that cannot answer fails the check at the group', async () => {
    const error = await failure({}, checkUnavailableGroup);
    assert.equal(error.code, 'GROUP_MISSING', error.message);
  });
} else if (mode === 'unavailable-group') {
  // The demo's finding O2 (INV4, plugin #281): a cluster with a metrics-server that is down (here an APIService whose Service has no endpoints, registered before the host started) kept the first Pods page of a fresh connection from loading,
  // "Connection admission requires complete discovered support.", and a press on Retry was what made it load. The page below is opened once and never helped. Parity mode's host is not used: it connected before the group was registered.
  test('the connection starts on the first try with an API group that cannot answer: the Pods list loads with no press on Retry, no request is refused, and the connection\'s facts name the group', async (t) => {
    const { read, oracle, facts, connectionID, cancelled } = await checkUnavailableGroup({ browser, baseURL, kubeconfig });
    t.diagnostic(`the page's own cancelled queries the check let through (unavailable.mjs): ${String(cancelled)}`);
    assert.equal(read.state, 'ready', 'the connection is up and the page lists the Pods');
    assert.equal(read.count, `${String(oracle.length)} Pods`, 'the footer counts the same Pods, the whole set');
    assert.ok(connectionID, 'the facts are those of a connection the host lists');
    assert.deepEqual(compareFacts(facts), [], 'the connection\'s facts name the group that cannot answer');
  });
} else {
  // The Overview (HM3c, plugin #287): the page a connection lands on. The window opens as the native app opens it and the plugin's row is pressed: one tab titled Overview, the connection's NAME as the one heading, the sidebar's Overview entry
  // current, Needs attention naming what fails (the fixture's failing Job and Pods), the Workloads table's Totals and Failing counts and the Cluster rows, each equal to what kubectl and the kubeconfig say (overview.mjs, with its controls in
  // overview.test.mjs). The page is sampled from the press, and no frame of it says a zero for a row that has not finished loading. It comes first: it is the one test that sees the page load on a connection the host has not started yet.
  test('the Overview the plugin lands on says what kubectl says, and says no zero while it loads', async (t) => {
    const { read, expected, identity, frames } = await checkOverview({ browser, baseURL, kubeconfig });
    t.diagnostic(`the page was sampled every 10 ms from the press: ${String(frames.samples)} samples read ${String(frames.distinct)} distinct pages, ${String(frames.loading.distinct)} of them with a row that was Loading (${String(frames.loading.samples)} samples), and it settled ${String(frames.settledAt)} ms after the press`);
    assert.deepEqual(read.tabs.map((tab) => tab.title), ['Overview'], 'one tab, titled Overview');
    assert.deepEqual(read.headings, [identity.context], 'the one heading is the connection\'s NAME, and not the ID the host lists for it');
    assert.deepEqual(read.current, ['Overview'], 'the sidebar\'s Overview entry is the current one');
    assert.equal(read.attention.count, expected.failingCount, 'Needs attention counts the objects kubectl lists as failing');
    assert.ok(read.attention.rows.some((row) => row.kind === 'Jobs' && row.names.includes('broken-migration')), 'Needs attention names the fixture\'s failing Job');
    assert.equal(read.summary.text, expected.summary);
  });

  test('the page and kubectl agree on the Pods of every namespace, on their count and on the quick filters', async () => {
    const { oracle, read, expected } = await checkParity({ browser, baseURL, kubeconfig });
    assert.equal(read.state, 'ready', 'the connection is up and the page lists the Pods');
    assert.equal(read.count, `${String(oracle.length)} Pods`, 'the footer counts the same Pods, the whole set');
    assert.deepEqual(read.filters, expected.filters, 'the quick filters count what kubectl says');
    // The one assertion about the connection's chip (H6): its text is the NAME of the connection, and not the ID that the host lists for it.
    const lane = compareLane(read.lane, await expectedLane({ baseURL, kubeconfig }));
    assert.equal(lane.length, 0, lane.join('; '));
  });

  // C1h: the ID is a key; no text the window draws and no accessible name carries it (the tab's name, the status bar, the sidebar's and the page's labels).
  test('the window draws no connection ID in its text or its accessible names', async () => {
    const page = await openPods(browser, baseURL);
    try {
      const { id } = await expectedLane({ baseURL, kubeconfig });
      const problems = compareDrawn(await readDrawn(page), id);
      assert.equal(problems.length, 0, problems.join('; '));
    } finally {
      await page.close();
    }
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

  // The generic detail page (K2c-2), opened from the Deployments list the sidebar's Deployments entry opens: the click on `cart-api` shows its Details rows, and the Strategy, the Revision and the Revision history
  // are what `kubectl get deployment -o json` says (detail.mjs). A plugin before the generic page has no such link and fails here. Parity mode only.
  test('the Deployment detail page, opened from the Deployments list, prints the strategy, revision and revision history kubectl says', async () => {
    const { read, expected } = await checkDeploymentDetail({ browser, baseURL, kubeconfig });
    assert.equal(read.h1, expected.name);
    assert.ok(read.kv.length >= 3, `the page draws the Details rows: ${JSON.stringify(read.kv)}`);
  });

  // A Deployment deleted while its page is open (K2c-2, plugin #279): the check makes its own (no replicas, so no Pod), opens its page from the list, deletes it with kubectl and reads the page's state: the title
  // `gone-check was deleted` over `It no longer exists in namespace checkout.`. The earlier plugin said `was not found` over a body that said it was deleted, and fails here. It removes what it made. Parity mode only.
  test('a Deployment deleted while its page is open is titled "was deleted", over where it no longer exists', async () => {
    const { read } = await checkDeploymentGone({ browser, baseURL, kubeconfig });
    assert.equal(read.title, 'gone-check was deleted');
  });

  // The sort (K3a, plugin #282): a press on a column header sorts the list, and the rows stand in the order `kubectl get <kind> -A -o json` gives (sort.mjs, `checkSort` in parity.mjs). The Pods list by Restarts: the
  // crash-looping Pod has restarted, a Pod with no container status has no value and is last in either direction, and the Pods of one count stand in name order; pressed again, the order reverses. Parity mode only.
  test('a press on the Restarts header of the Pods list sorts its rows as kubectl counts them, and a second press reverses them', async () => {
    const { first, second } = await checkSort({ browser, baseURL, kubeconfig, kind: 'pods' });
    assert.ok(first.ids.length > 0, 'the list has rows');
    assert.equal(second.direction, opposite(first.direction), 'the second press turns the column round');
  });

  // The Deployments list by Age: the rows stand in the order of their creation times (`creationTimestamp`), the oldest first when the column says ascending, and Deployments made in one second stand in name order.
  test('a press on the Age header of the Deployments list sorts its rows by creation time, and a second press reverses them', async () => {
    const { first, second } = await checkSort({ browser, baseURL, kubeconfig, kind: 'deployments' });
    assert.ok(first.ids.length > 0, 'the list has rows');
    assert.equal(second.direction, opposite(first.direction), 'the second press turns the column round');
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

  // S1-host: a BUSY Pod's Logs strip (two containers, each with a backlog of 3,000 lines and then 5 a second) never reads a rate above twice the Pod's, and settles near it: the replay the session opens with is never counted, because the plugin says where each
  // source's replay ends and the strip counts only what the source says is live (logs.mjs, `compareRate`, with its controls in logs.test.mjs; parity.mjs, `checkLogsRate`). It needs the plugin that declares the count (the pin of
  // this workflow is its first commit): against a plugin that does not, the strip says no rate for ever and this test fails on it. Parity mode only; it makes a Pod of its own, so it comes after the one that does the same.
  test('the Logs strip of a busy Pod never reads above twice the rate the Pod makes, and settles near it', async () => {
    const { samples, pod } = await checkLogsRate({ browser, baseURL, kubeconfig });
    assert.ok(samples.length >= 24, `the strip was read ${String(samples.length)} times`);
    assert.equal(pod.containers.length, 2);
  });

  // PF3-k8s (plugin #288): the Pod page's Forward port entry. A Pod that declares TCP 8080 (made for the check, the fixture declares no port) offers `Forward port 8080` in the page's menu, and the forward its press starts is listed in
  // the Ports tool with the host the plugin states: `localhost:<port> → :8080/TCP` (parity.mjs, `checkForward`). A plugin before #288 has no such entry and fails here. Parity mode only; it makes a Pod of its own, as the ones above.
  test('the Forward port entry of a Pod that declares a port starts a forward the Ports tool lists as localhost:<port>', async () => {
    const { read } = await checkForward({ browser, baseURL, kubeconfig });
    assert.match(read, /^localhost:\d+ → :8080\/TCP$/);
  });
}
