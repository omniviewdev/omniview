import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { converge } from './agreement.mjs';
import { compareCounts, countLines } from './counts.mjs';
import { compareDeployment, compareDetail, DETAIL_DEPLOYMENT, DETAIL_POD, deploymentHref, detailHref, expectedDeployment, expectedDetail } from './detail.mjs';
import { compareLogs, compareRepress, expectedLogs, LOGS_JOB, LOGS_RUNNING, READY_SECONDS, waitProcessMs, withOwnedPod } from './logs.mjs';
import { diffNames, fixtureGaps, ParityError, parseKubectlTable } from './oracle.mjs';

const run = promisify(execFile);

// The page's side of the contract: the only place that knows the list page's markup (the data view and its parts, `ui-next/page/` and the kit) and the test ids the
// Kubernetes plugin's cells carry (`pod-name`, `pod-namespace`: the plugin's `ui/src/pods/cells.tsx`). It reads
//   state     the body of the view (`data-ov-state` on its root): ready | loading | empty | no-match | error; null before the page is mounted
//   message   what a body without rows says: the alert of a failure, the busy status of a load, the status line of an empty list
//   count     the footer's count, as printed: `25 Pods` once the whole set is here, `25 Pods loaded` while it is arriving, `3 of 25 Pods` when filtered
//   filters   the quick-filter chips, as printed: `All 25`, `Running 18`, ...
//   names     `namespace/name` of every row mounted, sorted (the identity cell's name and its second line)
//   rowCount  how many rows the table says it holds (`aria-rowcount` less its header); the table mounts only the rows near its window, so a reading is
//             whole only when `names.length` equals it (`openPods` gives the page a window tall enough to mount every row of the fixture)
//   lane      the text of the Connection face of the scope lane above the page (`kind-ui-next-pods`), null when the lane has none: a person reads the connection's NAME there (lane.mjs)
//   status    one line of the above for a failure message
// PR 1a.2 and 1a.7 changed the page; they changed this function, not the checks around it.
export async function readPage(page) {
  return page.evaluate(() => {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    // What a person reads: a line break between a notice's title and its reason is a space, not nothing.
    const read = (element) => (element?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('[data-ov-state]');
    const state = root?.getAttribute('data-ov-state') ?? null;
    const body = root?.querySelector('[data-ov-part=body]') ?? null;
    const status = body?.querySelector('[role=status]') ?? null;
    const message = state === null || state === 'ready' ? '' : read(body?.querySelector('[role=alert]')) || status?.getAttribute('aria-label') || read(status);
    const count = text(root?.querySelector('[data-ov-part=footer] [data-ov-cluster=lead]')) || null;
    // The shell's scope lane: one face for each scope, drawn `<what>: <value>` (the face's last element holds two spans, the word and the text).
    const faces = [...document.querySelectorAll('[data-shell-part=lane] [data-shell-part=scopeFace]')].map((face) => ({
      what: text(face.lastElementChild?.firstElementChild).replace(/:$/, ''),
      value: text(face.lastElementChild?.lastElementChild),
    }));
    const lane = faces.find((face) => face.what === 'Connection')?.value ?? null;
    const table = root?.querySelector('table') ?? null;
    const names = [...(root?.querySelectorAll('tbody tr') ?? [])]
      .map((row) => {
        const name = text(row.querySelector('[data-testid=pod-name]'));
        const namespace = text(row.querySelector('[data-testid=pod-namespace]'));
        return namespace === '' ? name : `${namespace}/${name}`;
      })
      .sort();
    return {
      state,
      message,
      count,
      filters: [...(root?.querySelectorAll('[data-ov-block=filters] button') ?? [])].map((chip) => text(chip)),
      names,
      lane,
      rowCount: table === null ? 0 : Number(table.getAttribute('aria-rowcount')) - 1,
      status: `${state ?? 'no page'}${message === '' ? '' : `: ${message}`}${count === null ? '' : ` (${count})`}`,
    };
  });
}

// `timeoutMs` is how long the process may run: kubectl's calls are short, and the one that waits for a Pod to be Ready is given more than the wait it carries (logs.mjs, `waitProcessMs`).
export async function kubectl(kubeconfig, args, { timeoutMs = 60_000 } = {}) {
  const { stdout } = await run('kubectl', ['--kubeconfig', kubeconfig, ...args], { encoding: 'utf8', timeout: timeoutMs });
  return stdout;
}

// The oracle: kubectl's own table, never read from the page or from the fixture file. One row per Pod: its `namespace/name`, ready ratio and STATUS word.
export async function oracleRows(kubeconfig) {
  return parseKubectlTable(await kubectl(kubeconfig, ['get', 'pods', '-A', '--no-headers']));
}

export async function oraclePods(kubeconfig) {
  return (await oracleRows(kubeconfig)).map((row) => row.name);
}

export async function launchBrowser() {
  return chromium.launch();
}

// The table mounts only the rows near its window, so the window is made tall enough (4,000 px: 90 rows of 40 px and more) for every Pod of the
// fixture to be mounted at once. A reading that holds fewer rows than the table says it has is reported, not compared.
const WINDOW = { width: 1440, height: 4000 };

const WINDOW_SERVICE = 'github.com/omniviewdev/omniview/backend/window.Service';

// Nothing saved for the host's main window: what a first run of the app finds. Since S3a the host keeps the window's session (its tabs, the rail's choice, the panel) in its window service, and every page
// the check opens is that one window: a page that a case left behind would be restored by the next, so each case starts from a first run. A page that was just closed may still have a write on its way
// (the saver's quiet time, then the call): it lands first, or it would replace what is forgotten here. (The slot holds JSON, and JSON `null` is no session.)
async function forgetSession(baseURL) {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const response = await fetch(new URL('/wails/runtime', baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wails-client-id': 'pods-check' },
    body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `pods-forget-${String(Date.now())}`, methodName: `${WINDOW_SERVICE}.SaveState`, args: ['main', 'session', 'null'] } }),
  });
  if (!response.ok) {
    throw new Error(`the window's saved session could not be forgotten: ${String(response.status)} ${await response.text()}`);
  }
}

// The window as the native app opens it for a first run: `/`, no `?screen=`, no hash, no connection, nothing saved. It is the EMPTY window (decision A17, S3a: no page opens by itself): the plugins that can
// be opened are listed, a plugin that did not load among them, and the rail beside them has an entry for each. `options` are the page's own (a check that compares clocks gives it a time zone).
export async function openWindow(browser, baseURL, options = {}) {
  await forgetSession(baseURL);
  const page = await browser.newPage({ viewport: WINDOW, ...options });
  await page.goto(new URL('/', baseURL).href);
  return page;
}

// The plugin's page, opened the way a person opens it from that window: the plugin's row in the list of plugins that can be opened. It is the same in every mode of the check: a plugin installed without its
// bundle is in the list too ("Did not load") and its row opens the page that names the failure, and a host without the plugin has no row, so the window stays at its own list of plugins (the page the
// check reads and finds wanting). What the page shows is the plugin's page, named by the plugin's contribution.
export async function openPods(browser, baseURL, options = {}) {
  const page = await openWindow(browser, baseURL, options);
  const row = page.getByRole('region', { name: 'Plugins you can open' }).getByRole('button', { name: /^Kubernetes/ });
  try {
    await row.click({ timeout: 20_000 });
  } catch {
    // No row: the host has no such plugin. The window's own screen says so, and that is what the check reads.
  }
  return page;
}

// Polls until `done(read)` or the deadline; returns the last reading either way.
export async function settle(page, done, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let read = await readPage(page);
  while (!done(read) && Date.now() < deadline) {
    await page.waitForTimeout(100);
    read = await readPage(page);
  }
  return read;
}

// The check: the cluster holds the fixture, and the window the host opens with no URL parameter and no hash (the first page a loaded plugin contributes: here the
// Kubernetes plugin's, from its own bundle) lists exactly the Pods `kubectl get pods -A` lists, counts them as it does in its footer, and counts its quick filters
// from kubectl's own STATUS words (plan 1a.6 exit test). The page and kubectl are never read at the same instant, so kubectl is read before and after every reading of
// the page, and a Pod kubectl itself changed in between may read either way on the page: nothing else may (agreement.mjs).
// Throws ParityError('FIXTURE_MISSING') when the cluster is empty of the fixture, ParityError('PAGE_MISMATCH') when the page does not agree before the deadline.
export async function checkParity({ browser, baseURL, kubeconfig, timeoutMs = 30_000 }) {
  const oracle = (await oracleRows(kubeconfig)).map((row) => row.name);
  const gaps = fixtureGaps(oracle);
  if (gaps.length > 0) {
    throw new ParityError('FIXTURE_MISSING', `the cluster lacks the fixture: ${gaps.join('; ')}`, { gaps, oracle });
  }

  const page = await openPods(browser, baseURL);
  try {
    const result = await converge({ kubectl: () => oracleRows(kubeconfig), readPage: () => readPage(page), timeoutMs });
    if (!result.agreed) {
      const names = result.after.map((row) => row.name);
      const changed = result.changing.length > 0 ? `; kubectl changed ${result.changing.join(', ')} between its two reads of the last comparison, so that Pod may read either way` : '';
      throw new ParityError(
        'PAGE_MISMATCH',
        `${result.problems.join('; ')}; page status ${JSON.stringify(result.read.status)}; ${String(result.attempt)} comparisons in ${String(timeoutMs / 1000)} s, each with kubectl read before and after the page${changed}`,
        { diff: diffNames(result.read.names, names), status: result.read.status, pageNames: result.read.names, oracle: names, read: result.read, attempts: result.attempt },
      );
    }
    return { oracle: result.matched.names, status: result.read.status, read: result.read, expected: { count: result.matched.count, filters: result.matched.filters } };
  } finally {
    await page.close();
  }
}

// The Pod detail page, opened the way a person opens it: the click on the Pod's name in the Pods list (the plugin's list draws the name as a link to the detail page).
// The Pod is read with `kubectl get pod -o json`; the page's header title and its Details rows (Node, Pod IP, Host IP, QoS class) must print what kubectl says.
// Polls until the page agrees or the deadline, then throws ParityError('DETAIL_MISMATCH') with the last problems.
// The sidebar's counts (Q2, counts.mjs): the Pods list is the page on screen, so the Workloads group is open and its kinds are on screen with the two entries of the top level. Each row is named by its
// content, the label and then the count the plugin drew: `Pods 50`, `Deployments about 11`, `Jobs 0`. The cluster is read before and after every reading of the sidebar: a kind that changed in between is read again.
const COUNTED = [
  { label: 'Nodes', resource: 'nodes', namespaced: false },
  { label: 'Namespaces', resource: 'namespaces', namespaced: false },
  { label: 'Pods', resource: 'pods', namespaced: true },
  { label: 'Deployments', resource: 'deployments', namespaced: true },
  { label: 'StatefulSets', resource: 'statefulsets', namespaced: true },
  { label: 'DaemonSets', resource: 'daemonsets', namespaced: true },
  { label: 'ReplicaSets', resource: 'replicasets', namespaced: true },
  { label: 'Jobs', resource: 'jobs', namespaced: true },
  { label: 'CronJobs', resource: 'cronjobs', namespaced: true },
];

async function oracleCounts(kubeconfig) {
  const counts = await Promise.all(COUNTED.map(async ({ resource, namespaced }) => countLines(await kubectl(kubeconfig, ['get', resource, ...(namespaced ? ['-A'] : []), '--no-headers']))));
  return Object.fromEntries(COUNTED.map(({ label }, index) => [label, counts[index]]));
}

// The sidebar's rows as a screen reader names them: the label, then what the count says (an estimate is drawn `~11` and named `about 11`: the word is a text that is not drawn, after the drawn tilde).
async function sidebarRows(page) {
  return page.getByRole('navigation', { name: 'Kubernetes resources' }).getByRole('treeitem').evaluateAll((rows) =>
    rows.map((row) => {
      const slot = row.querySelector('[data-shell-part="count"]');
      const said = slot === null ? '' : (slot.querySelector('[aria-hidden="true"]')?.nextElementSibling?.textContent ?? slot.textContent ?? '');
      return `${row.children[1]?.textContent?.trim() ?? ''} ${said.trim()}`.trim();
    }),
  );
}

// Throws ParityError('COUNT_MISMATCH') when the sidebar does not agree with kubectl before the deadline.
export async function checkCounts({ browser, baseURL, kubeconfig, timeoutMs = 45_000 }) {
  const page = await openPods(browser, baseURL);
  try {
    const deadline = Date.now() + timeoutMs;
    let rows = [];
    let expected = {};
    let problems = ['the sidebar is not on screen'];
    do {
      await page.waitForTimeout(250);
      const before = await oracleCounts(kubeconfig);
      rows = await sidebarRows(page);
      expected = await oracleCounts(kubeconfig);
      problems = JSON.stringify(before) !== JSON.stringify(expected) ? ['the cluster changed while the sidebar was read'] : compareCounts({ rows, expected, open: 'Pods' });
    } while (problems.length > 0 && Date.now() < deadline);
    if (problems.length > 0) {
      throw new ParityError('COUNT_MISMATCH', problems.join('; '), { problems, rows, expected });
    }
    return { rows, expected };
  } finally {
    await page.close();
  }
}

// Opens a detail page from its kind's list (the click on the object's name link) and polls until the page agrees with `oracle` or the deadline, then throws ParityError('DETAIL_MISMATCH') with the last problems.
// `listEntry` is the sidebar entry that opens the list when the Pods list is not the page on screen (a name or `undefined`); `what` names the object in a failure.
async function checkDetailOf({ browser, baseURL, href, listEntry, oracle, compare, what, timeoutMs }) {
  const page = await openPods(browser, baseURL);
  try {
    if (listEntry !== undefined) {
      await page.getByRole('navigation', { name: 'Kubernetes resources' }).getByRole('treeitem', { name: new RegExp(`^${listEntry}`) }).click({ timeout: timeoutMs });
    }

    const link = page.locator(`a[href="${href}"]`).first();
    try {
      await link.waitFor({ timeout: timeoutMs });
    } catch {
      throw new ParityError('DETAIL_MISMATCH', `${what}: the ${listEntry ?? 'Pods'} list does not link it to its page (${href})`, { problems: ['no link'], href });
    }

    await link.click();
    const deadline = Date.now() + timeoutMs;
    let read;
    let expected;
    let problems;
    do {
      await page.waitForTimeout(100);
      // Each page reading is bracketed by two reads of the object: one replaced in between (a StatefulSet Pod keeps its name and gets a new IP) is read again, it is not a defect of the page.
      const before = await oracle();
      read = await readDetail(page);
      expected = await oracle();
      if (JSON.stringify(before) !== JSON.stringify(expected)) {
        problems = ['the object changed while the page was read'];
      } else {
        problems = read.h1 === null ? ['the detail page is not on screen'] : compare(read, expected);
      }
    } while (problems.length > 0 && Date.now() < deadline);
    if (problems.length > 0) {
      throw new ParityError('DETAIL_MISMATCH', `${what}: ${problems.join('; ')}`, { problems, read, expected });
    }
    return { read, expected };
  } finally {
    await page.close();
  }
}

export async function checkDetail({ browser, baseURL, kubeconfig, pod = DETAIL_POD, timeoutMs = 30_000 }) {
  return checkDetailOf({
    browser,
    baseURL,
    href: detailHref(pod),
    listEntry: undefined,
    oracle: async () => expectedDetail(JSON.parse(await kubectl(kubeconfig, ['get', 'pod', pod.name, '-n', pod.namespace, '-o', 'json']))),
    compare: compareDetail,
    what: `${pod.namespace}/${pod.name}`,
    timeoutMs,
  });
}

// The generic detail page (K2c-2), opened from the Deployments list: the sidebar's Deployments entry, then the click on the Deployment's name. The page's Details rows (Strategy, Revision, Revision history)
// and its title must print what `kubectl get deployment -o json` says. A plugin without the generic page has no link to click: the check reports it.
export async function checkDeploymentDetail({ browser, baseURL, kubeconfig, deployment = DETAIL_DEPLOYMENT, timeoutMs = 30_000 }) {
  return checkDetailOf({
    browser,
    baseURL,
    href: deploymentHref(deployment),
    listEntry: 'Deployments',
    oracle: async () => expectedDeployment(JSON.parse(await kubectl(kubeconfig, ['get', 'deployment', deployment.name, '-n', deployment.namespace, '-o', 'json']))),
    compare: compareDeployment,
    what: `${deployment.namespace}/${deployment.name}`,
    timeoutMs,
  });
}

// The detail page on screen: the visible page slot's header title and the rows of its Details section, as printed.
async function readDetail(page) {
  return page.evaluate(() => {
    const norm = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
    const slot = [...document.querySelectorAll('[data-page-slot]')].find((candidate) => candidate.getClientRects().length > 0) ?? document.querySelector('[data-shell-part=page]');
    const header = slot?.querySelector('[data-detail-part=header]') ?? null;
    const details = slot?.querySelector('[data-detail-section=details] [data-ov-part=key-value]') ?? null;
    return {
      h1: header === null ? null : norm(header.querySelector('h1')?.textContent),
      kv: [...(details?.querySelectorAll('[data-ov-part=row]') ?? [])].map((row) => [norm(row.querySelector('[data-ov-part=label]')?.textContent), norm(row.querySelector('[data-ov-part=value]')?.textContent)]),
    };
  });
}

// The SDK's log sessions, asked of the host as the page asks (`ServiceWrapper.ListSessions` of the log service): every session its log manager holds, ended ones included, until something closes them. The old UI
// never closed one; the host closes the session of a Logs tab when the tab closes, so this is what shows that the open and the close reached the backend.
const LOGS_SERVICE = 'github.com/omniviewdev/omniview/backend/pkg/plugin/logs.ServiceWrapper';

export async function listLogSessions(baseURL) {
  const response = await fetch(new URL('/wails/runtime', baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wails-client-id': 'pods-check' },
    body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `pods-logs-${String(Date.now())}`, methodName: `${LOGS_SERVICE}.ListSessions`, args: [] } }),
  });
  if (!response.ok) {
    throw new Error(`the SDK's log sessions could not be listed: ${String(response.status)} ${await response.text()}`);
  }

  const sessions = await response.json();
  if (sessions !== null && !Array.isArray(sessions)) {
    throw new Error(`the SDK's log sessions were not a list: ${JSON.stringify(sessions).slice(0, 200)}`);
  }

  return sessions ?? [];
}

// The Logs tool on screen: the accessible names of its session tabs, and the rows of the session shown, as printed (the clock cell and the line cell; a marker where lines were dropped has no line cell).
async function readLogs(page) {
  return page.evaluate(() => {
    const view = document.querySelector('[data-log-session]');
    return {
      tabs: [...document.querySelectorAll('[role=tablist][aria-label="Logs sessions"] [role=tab]')].map((tab) => tab.getAttribute('aria-label') ?? ''),
      rows: [...(view?.querySelectorAll('[role=grid] [role=row][data-n]') ?? [])].map((row) => {
        const cells = row.querySelectorAll('[role=gridcell]');
        return { time: cells[0]?.textContent ?? '', text: cells[2]?.textContent ?? '' };
      }),
    };
  });
}

// Closes the first Logs session tab, as a person does: its close control, shown on hover. A page with no session tab has nothing to close. The host closes the session's stream when the tab closes, over a call that
// needs a moment to leave the page before the page itself may be closed.
async function closeLogsTab(page) {
  const tab = page.locator('[data-shell-part=sessionTab]').first();
  if ((await tab.count()) === 0) {
    return;
  }

  await tab.hover();
  await page.locator('[data-shell-part=sessionTab] [data-shell-part=sessionClose]').first().click({ force: true, timeout: 5_000 });
  await page.waitForTimeout(300);
}

// The Logs of a Pod, opened the way a person opens them: the Pod's page (the click on its name in the Pods list), then the header's Logs command. A Pod of the Job `nightly-report` is Completed and wrote its lines
// already, so the session in the host's Logs tool reads the whole log and ends: its rows must be the lines `kubectl logs --timestamps` prints (the page is given the UTC time zone, so the clocks compare as text),
// and the SDK holds one more session while the tab is open and the same number as before once the tab is closed. This is the first real log stream of the new stack (docs/ui-next/status/P1b-3b.md).
// Throws ParityError('FIXTURE_MISSING') when the Job has no Pod, ParityError('LOGS_MISMATCH') when the session does not agree before the deadline or the SDK does not follow the tab.
export async function checkLogs({ browser, baseURL, kubeconfig, timeoutMs = 30_000 }) {
  const names = (await kubectl(kubeconfig, ['get', 'pods', '-n', LOGS_JOB.namespace, '-l', `job-name=${LOGS_JOB.name}`, '-o', 'name']))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.replace(/^pod\//, ''))
    .sort();
  if (names.length === 0) {
    throw new ParityError('FIXTURE_MISSING', `the cluster lacks the Pods of the Job ${LOGS_JOB.namespace}/${LOGS_JOB.name}`, { names });
  }

  const pod = { namespace: LOGS_JOB.namespace, name: names[0] };
  const expected = expectedLogs(await kubectl(kubeconfig, ['logs', '-n', pod.namespace, pod.name, '--timestamps']));
  const before = (await listLogSessions(baseURL)).length;
  const page = await openPods(browser, baseURL, { timezoneId: 'UTC' });
  try {
    const link = page.locator(`a[href="${detailHref(pod)}"]`).first();
    await link.waitFor({ timeout: timeoutMs });
    await link.click();
    // Playwright waits for the command to be enabled: the page enables it once the record of the Pod shows a container that ran.
    await page.getByRole('button', { name: 'Logs', exact: true }).first().click({ timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    // What a reading says is wrong with the session: it is the only one, its rows are kubectl's lines, and it has ENDED (the log of a Completed Pod is read to its end).
    const problemsOf = (reading) => {
      if (reading.tabs.length !== 1) {
        return [`the Logs tool holds ${String(reading.tabs.length)} sessions, not the one just opened`];
      }

      const found = compareLogs(reading.rows, expected);
      return found.length === 0 && !reading.tabs[0].endsWith(', ended') ? ['the session has not ended'] : found;
    };
    let read;
    let problems;
    do {
      await page.waitForTimeout(100);
      read = await readLogs(page);
      problems = problemsOf(read);
    } while (problems.length > 0 && Date.now() < deadline);
    if (problems.length === 0) {
      // The reading agrees and the session has ended; a line still on its way (the host sends the end ahead of the last batch) would show after a quiet moment, so the reading is taken once more.
      await page.waitForTimeout(500);
      read = await readLogs(page);
      problems = problemsOf(read);
    }

    if (problems.length > 0) {
      throw new ParityError('LOGS_MISMATCH', `${pod.namespace}/${pod.name}: ${problems.join('; ')}`, { problems, read, expected });
    }

    const open = (await listLogSessions(baseURL)).length;
    await closeLogsTab(page);
    let closed = (await listLogSessions(baseURL)).length;
    for (let attempt = 0; closed !== before && attempt < 100; attempt += 1) {
      await page.waitForTimeout(100);
      closed = (await listLogSessions(baseURL)).length;
    }

    if (open !== before + 1 || closed !== before) {
      throw new ParityError(
        'LOGS_MISMATCH',
        `${pod.namespace}/${pod.name}: the SDK held ${String(before)} log sessions, ${String(open)} with the tab open (one more is expected) and ${String(closed)} after it was closed (the same as before is expected)`,
        { before, open, closed },
      );
    }

    return { read, expected, pod, sessions: { before, open, closed } };
  } finally {
    // A check that failed leaves no session running in the host: the tab is closed whatever happened (a page that closes by itself leaves the SDK's session open).
    await closeLogsTab(page).catch(() => undefined);
    await page.close();
  }
}

// The Logs command of a RUNNING Pod pressed twice (P1b-3d, A22: a session is its plugin and its target). The Pod is made for the check (`LOGS_RUNNING`: a busybox that writes a line a second and never ends); its page is
// opened from the list as a person opens it and the header's Logs command is pressed twice. The first press opens the session and the second shows it: the Logs tool holds ONE tab, named for the Pod, and the SDK one
// session more, not two; closing the tab closes the SDK's session. The first proof of a re-activation against a real cluster. The Pod is the check's own: a Pod of its name that is already there is neither used nor deleted,
// and one the check makes is deleted whatever happens, its creation included (logs.mjs, `withOwnedPod`).
// Throws ParityError('LOGS_MISMATCH') when the readings differ from what `compareRepress` (logs.mjs) says they must be.
export async function checkLogsTwice(options) {
  const { kubeconfig } = options;
  const pod = LOGS_RUNNING;
  const at = ['-n', pod.namespace];
  return withOwnedPod(
    {
      exists: async () => (await kubectl(kubeconfig, ['get', 'pod', pod.name, ...at, '--ignore-not-found', '-o', 'name'])).trim() !== '',
      create: () => kubectl(kubeconfig, ['run', pod.name, ...at, '--image=busybox:1.37.0', '--restart=Never', '--', 'sh', '-c', 'i=0; while true; do i=$((i + 1)); echo "line $i"; sleep 1; done']),
      remove: () => kubectl(kubeconfig, ['delete', 'pod', pod.name, ...at, '--ignore-not-found', '--grace-period=0', '--force', '--wait=false']),
    },
    () => pressTwice(options),
  );
}

// The part of the press-twice case that needs the Pod to be there: wait for it, then press the Logs command of its page twice and read the tool and the SDK.
async function pressTwice({ browser, baseURL, kubeconfig, timeoutMs = 60_000 }) {
  const pod = LOGS_RUNNING;
  await kubectl(kubeconfig, ['wait', '--for=condition=Ready', `pod/${pod.name}`, '-n', pod.namespace, `--timeout=${String(READY_SECONDS)}s`], { timeoutMs: waitProcessMs(READY_SECONDS) });
  let page;
  try {
    const before = (await listLogSessions(baseURL)).length;
    page = await openPods(browser, baseURL, { timezoneId: 'UTC' });
    const link = page.locator(`a[href="${detailHref(pod)}"]`).first();
    await link.waitFor({ timeout: timeoutMs });
    await link.click();
    const press = () => page.getByRole('button', { name: 'Logs', exact: true }).first().click({ timeout: timeoutMs });
    await press();
    // The session is streaming once its tab is there and holds a line: its name is then the Pod's alone (a session that is starting has its state in its name).
    const deadline = Date.now() + timeoutMs;
    let reading = await readLogs(page);
    while ((reading.tabs.length === 0 || reading.rows.length === 0) && Date.now() < deadline) {
      await page.waitForTimeout(100);
      reading = await readLogs(page);
    }

    const first = { tabs: reading.tabs, sessions: (await listLogSessions(baseURL)).length };
    await press();
    // A session the second press wrongly opened shows within a moment: the page is read after one, and the SDK is asked after the page.
    await page.waitForTimeout(1_500);
    reading = await readLogs(page);
    const second = { tabs: reading.tabs, sessions: (await listLogSessions(baseURL)).length };
    await closeLogsTab(page);
    let closed = (await listLogSessions(baseURL)).length;
    for (let attempt = 0; closed !== before && attempt < 100; attempt += 1) {
      await page.waitForTimeout(100);
      closed = (await listLogSessions(baseURL)).length;
    }

    const found = { before, first, second, closed: { sessions: closed } };
    const problems = compareRepress(found, pod.name);
    if (problems.length > 0) {
      throw new ParityError('LOGS_MISMATCH', `${pod.namespace}/${pod.name}: ${problems.join('; ')}`, { problems, found });
    }

    return { found, pod };
  } finally {
    if (page !== undefined) {
      await closeLogsTab(page).catch(() => undefined);
      await page.close().catch(() => undefined);
    }
  }
}

// The host's own list of the plugin's connections, asked as the page asks (`ServiceWrapper.ListConnections` of the resource service). Since plugin PR #272 a connection's ID is derived from the path of its kubeconfig and
// the name of its context (`<slug>-<10 hex>`), and the check's kubeconfig lives in a temporary directory: the ID is another one on every run, so it is read here and never written into the check.
const RESOURCE_SERVICE = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.ServiceWrapper';
const KUBERNETES_PLUGIN_ID = 'kubernetes';

export async function listConnections(baseURL, pluginID = KUBERNETES_PLUGIN_ID) {
  const response = await fetch(new URL('/wails/runtime', baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wails-client-id': 'pods-check' },
    body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `pods-connections-${String(Date.now())}`, methodName: `${RESOURCE_SERVICE}.ListConnections`, args: [pluginID] } }),
  });
  if (!response.ok) {
    throw new Error(`the connections of ${pluginID} could not be listed: ${String(response.status)} ${await response.text()}`);
  }

  const connections = await response.json();
  if (!Array.isArray(connections)) {
    throw new Error(`the connections of ${pluginID} were not a list: ${JSON.stringify(connections).slice(0, 200)}`);
  }

  return connections;
}

// What the scope lane's Connection face must say (lane.mjs): the context kubectl calls current, and the ID the host lists for the connection of that context (`data.context` is the exact context name the plugin
// puts in every connection it lists). The ID is what the lane must not say; it is `undefined` when the host lists no such connection.
export async function expectedLane({ baseURL, kubeconfig }) {
  const context = (await kubectl(kubeconfig, ['config', 'current-context'])).trim();
  const connection = (await listConnections(baseURL)).find((candidate) => candidate?.data?.context === context);
  return { context, id: connection?.id };
}
