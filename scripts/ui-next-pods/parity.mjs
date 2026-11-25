import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { converge } from './agreement.mjs';
import { compareCounts, countLines } from './counts.mjs';
import { compareDeployment, compareDetail, compareGone, DETAIL_DEPLOYMENT, DETAIL_POD, deploymentHref, detailHref, expectedDeployment, expectedDetail, goneDeployment } from './detail.mjs';
import { busyPod, busyRate, busyReplayed, compareLogs, compareRate, compareRepress, expectedLogs, LOGS_BUSY, LOGS_JOB, LOGS_RUNNING, readStrip, READY_SECONDS, TELLING_SAMPLES, waitProcessMs, withOwnedPod } from './logs.mjs';
import { diffNames, fixtureGaps, ParityError, parseKubectlTable } from './oracle.mjs';
import { compareOverview, expectedOverview, frameProblems, isSettled, loadingFrames, readOverview } from './overview.mjs';
import { compareSorted, deploymentsByAge, directionOf, opposite, podsByRestarts, sortCanBeTold } from './sort.mjs';
import { APISERVICE, AVAILABLE_JSONPATH, compareAvailability, compareFacts, refusedRequests } from './unavailable.mjs';

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
    // The shell's scope lane: one face for each scope, drawn `<what>: <value>`: the glyph, then an element that holds two spans, the word and the text. A face the host made a control (HM1) is a button with a chevron after that element, so it
    // is the second child, which is the last of a face that is only text.
    const faces = [...document.querySelectorAll('[data-shell-part=lane] [data-shell-part=scopeFace]')].map((face) => ({
      what: text(face.children[1]?.firstElementChild).replace(/:$/, ''),
      value: text(face.children[1]?.lastElementChild),
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

// The plugin's landing, opened the way a person opens it from that window: the plugin's row in the list of plugins that can be opened. It is the same in every mode of the check: a plugin installed without its
// bundle is in the list too ("Did not load") and its row opens the page that names the failure, and a host without the plugin has no row, so the window stays at its own list of plugins (the page the
// check reads and finds wanting). What the page shows is the plugin's page, named by the plugin's contribution: since plugin #287 the connection's Overview (`checkOverview`).
export async function openOverview(browser, baseURL, options = {}) {
  const page = await openWindow(browser, baseURL, options);
  await openPluginPage(page);
  return page;
}

// The Pods list, opened the way a person opens it from the landing: the plugin's page, and then the sidebar's Workloads group and its Pods entry. Every check of a list or of the page of an object starts here. A window that
// has no row to press has no sidebar to choose from either, and is read as it stands (the control of a host without the plugin).
export async function openPods(browser, baseURL, options = {}) {
  const page = await openWindow(browser, baseURL, options);
  if (await openPluginPage(page)) {
    await choosePods(page);
  }

  return page;
}

// The press on the plugin's row, on a window that is open. A check that has to hear the page from its first request opens the window (`openWindow`), attaches what it listens with, and then presses the row (`checkUnavailableGroup`).
// Returns whether there was a row to press.
export async function openPluginPage(page) {
  const row = page.getByRole('region', { name: 'Plugins you can open' }).getByRole('button', { name: /^Kubernetes/ });
  try {
    await row.click({ timeout: 20_000 });
    return true;
  } catch {
    // No row: the host has no such plugin. The window's own screen says so, and that is what the check reads.
    return false;
  }
}

// The sidebar's Pods entry, on a window that has the plugin's page: the Workloads group is opened when it is closed (the landing of the plugin before the Overview was the Pods list, and the group is open for it), and Pods is
// pressed, which opens the list in the tab. A window with no sidebar (the plugin's page failed to load) is left as it is.
export async function choosePods(page) {
  const tree = page.getByRole('navigation', { name: 'Kubernetes resources' });
  const workloads = tree.getByRole('treeitem', { name: 'Workloads', exact: true });
  try {
    await workloads.waitFor({ timeout: 20_000 });
  } catch {
    return false;
  }

  const pods = tree.getByRole('treeitem', { name: /^Pods(?: |$)/ });
  if (!(await pods.isVisible())) {
    await workloads.click({ timeout: 20_000 });
  }

  await pods.click({ timeout: 20_000 });
  return true;
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

// The check: the cluster holds the fixture, and the Pods list the window reaches the way a person does (the host opens with no URL parameter and no hash, the Kubernetes plugin's row is pressed and lands on its Overview, and the
// sidebar's Workloads group and Pods entry open the list) lists exactly the Pods `kubectl get pods -A` lists, counts them as it does in its footer, and counts its quick filters
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
    return await agreeWithKubectl(page, kubeconfig, timeoutMs);
  } finally {
    await page.close();
  }
}

// The agreement itself, on a page that is open: kubectl, the page and kubectl again, until the page agrees or `timeoutMs` has passed (see above). Throws ParityError('PAGE_MISMATCH') with the last problems.
async function agreeWithKubectl(page, kubeconfig, timeoutMs) {
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
}

// The Overview, the page the plugin lands on (HM3c; plugin PR #287). The window is opened as the native app opens it and the plugin's row is pressed; the page is read the way a person reads it, in the page's own markup (the host's
// `ui-next/page/DetailPage.tsx`, the kit's parts, the plugin's `ui/src/overview/cells.tsx`), and every reading is text. What it means, and what kubectl says it must be, is overview.mjs's.
// This function runs in the page, so it names nothing outside itself. Installed BEFORE the press, it samples the page every `intervalMs` from the click on the plugin's row (the capture phase of the first click of the window, so
// that the first sample is the press's own) and keeps each reading that differs from the one before, with the number of samples that read exactly it: the frames a person could see between the press and the settled page.
// The reading: the strip's tabs, the headings of level 1 of the page on screen, the sidebar's current entries, the items of the summary line, and each section (`data-detail-section`) as the text of its rows: a list's rows are
// `[title, detail]`, a table's are its cells, a key and value list's are `[label, value]`.
function installOverviewRecorder(intervalMs) {
  const norm = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
  const rowsOf = (card) => {
    const table = card.querySelector('table');
    if (table !== null) {
      return { kind: 'table', head: [...table.querySelectorAll('thead th')].map((cell) => norm(cell.textContent)), rows: [...table.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => norm(cell.textContent))) };
    }

    const list = card.querySelector('[data-ov-part=list-rows]');
    if (list !== null) {
      return { kind: 'list', rows: [...list.querySelectorAll('[data-ov-part=list-row]')].map((row) => [norm(row.querySelector('[data-ov-part=title]')?.textContent), norm(row.querySelector('[data-ov-part=detail]')?.textContent)]) };
    }

    const pairs = card.querySelector('[data-ov-part=key-value]');
    return pairs === null
      ? { kind: 'none', rows: [] }
      : { kind: 'kv', rows: [...pairs.querySelectorAll('[data-ov-part=row]')].map((row) => [norm(row.querySelector('[data-ov-part=label]')?.textContent), norm(row.querySelector('[data-ov-part=value]')?.textContent)]) };
  };
  const read = () => {
    const slot = [...document.querySelectorAll('[data-page-slot]')].find((candidate) => candidate.getClientRects().length > 0) ?? null;
    const summary = slot?.querySelector('[data-ov-part=status-summary]') ?? null;
    return {
      tabs: [...document.querySelectorAll('[role=tablist][aria-label="Open tabs"] [role=tab]')].map((tab) => ({ title: norm(tab.textContent), name: tab.getAttribute('aria-label') ?? '', selected: tab.getAttribute('aria-selected') === 'true' })),
      headings: [...(slot?.querySelectorAll('h1') ?? [])].map((heading) => norm(heading.textContent)),
      current: [...document.querySelectorAll('[role=tree] [role=treeitem][aria-selected=true]')].map((item) => norm(item.querySelector('[data-ov-clip]')?.textContent ?? item.textContent)),
      summary: summary === null ? null : [...summary.querySelectorAll('[data-ov-part=item]')].map((item) => norm(item.textContent)),
      sections: [...(slot?.querySelectorAll('[data-detail-section]') ?? [])].map((card) => ({
        id: card.getAttribute('data-detail-section') ?? '',
        title: norm(card.querySelector('[data-ov-part=heading]')?.textContent),
        meta: norm(card.querySelector('[data-ov-part=meta]')?.textContent),
        ...rowsOf(card),
      })),
    };
  };
  const frames = [];
  let samples = 0;
  let last = '';
  let started = 0;
  let timer;
  const sample = () => {
    samples += 1;
    const dom = read();
    const key = JSON.stringify(dom);
    if (key === last) {
      frames[frames.length - 1].count += 1;
      return;
    }

    last = key;
    frames.push({ at: Math.round(performance.now() - started), count: 1, dom });
  };

  document.addEventListener(
    'click',
    () => {
      started = performance.now();
      sample();
      timer = setInterval(sample, intervalMs);
    },
    { capture: true, once: true },
  );
  window.__overview = { read, frames, samples: () => samples, stop: () => clearInterval(timer) };
}

// How often the recorder reads the page from the press: short against the time the page takes to settle (about 250 ms for the fixture's cluster on a laptop), long enough that a reading never waits for the one before.
const OVERVIEW_SAMPLE_MS = 10;

// What does not change while the check runs, asked of the cluster once: the server's version (`kubectl version`) and the address of the API server in the kubeconfig for the current context.
async function oracleFacts(kubeconfig) {
  const version = JSON.parse(await kubectl(kubeconfig, ['version', '-o', 'json'])).serverVersion?.gitVersion;
  const server = (await kubectl(kubeconfig, ['config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}'])).trim();
  if (typeof version !== 'string' || version === '') {
    throw new Error('kubectl says nothing of the server\'s version: the check cannot compare the Cluster section');
  }

  return { version, server };
}

// What the cluster says that the Overview counts: the Pods as kubectl's own table prints them, and the other kinds as objects (the items of one list for each of the namespaced kinds and of the Nodes and the Namespaces).
async function oracleOverview(kubeconfig) {
  const [pods, workloads, cluster] = await Promise.all([
    oracleRows(kubeconfig),
    kubectl(kubeconfig, ['get', 'deployments,statefulsets,daemonsets,jobs,cronjobs,persistentvolumeclaims', '-A', '-o', 'json']),
    kubectl(kubeconfig, ['get', 'nodes,namespaces', '-o', 'json']),
  ]);
  return { pods, objects: [...JSON.parse(workloads).items, ...JSON.parse(cluster).items] };
}

// The connection's NAME (the context kubectl calls current) and the ID the host lists for it. A host that cannot list the plugin's connections (it has no such plugin) leaves the ID out: the heading is what is compared.
async function connectionIdentity({ baseURL, kubeconfig }) {
  try {
    return await expectedLane({ baseURL, kubeconfig });
  } catch {
    return { context: (await kubectl(kubeconfig, ['config', 'current-context'])).trim(), id: undefined };
  }
}

// The Overview the plugin lands on says what kubectl says (overview.mjs): the window opened as the native app opens it and the plugin pressed, one tab titled Overview, one heading that is the connection's NAME (never its
// ID), the sidebar's Overview entry current, Needs attention naming what fails (the count of the section and of its rows, and every name a row shows, held to kubectl's failing objects), the Workloads table's Totals and
// Failing counts and the Cluster rows equal to kubectl's, and no fake zero while it loads: the page is sampled from the press until it has settled, and every frame is held to the rules of a page that has not finished
// (a row that says Loading shows no None failing, a Cluster row that says Loading shows no number, the summary does not say Everything is running while a row says Loading). kubectl is read before and after every reading of the
// page, and a reading whose cluster moved is read again (the fixture's crash-looping Pod flips between words).
// Throws ParityError('FIXTURE_MISSING') when the cluster is empty of the fixture (an Overview of an empty cluster agrees with kubectl too: the check must stop there), ParityError('OVERVIEW_MISMATCH') when the settled page does not
// agree before the deadline (the page of a host without the plugin, and of a plugin without its bundle, are none of them an Overview) and ParityError('OVERVIEW_LOADING') when a frame broke a rule of a page that is loading.
// Returns the settled reading, the page kubectl says, the connection's identity and what the sampling saw (`frames`: samples, distinct readings, the frames and samples with a row that was Loading, the time the page settled).
export async function checkOverview({ browser, baseURL, kubeconfig, timeoutMs = 30_000, intervalMs = OVERVIEW_SAMPLE_MS }) {
  const listed = (await oracleRows(kubeconfig)).map((row) => row.name);
  const gaps = fixtureGaps(listed);
  if (gaps.length > 0) {
    throw new ParityError('FIXTURE_MISSING', `the cluster lacks the fixture: ${gaps.join('; ')}`, { gaps, oracle: listed });
  }

  const facts = await oracleFacts(kubeconfig);
  const page = await openWindow(browser, baseURL);
  try {
    await page.evaluate(installOverviewRecorder, intervalMs);
    const pressed = await openPluginPage(page);
    const identity = await connectionIdentity({ baseURL, kubeconfig });
    // A window that has no row to press cannot get an Overview by waiting: it is read once.
    const deadline = Date.now() + (pressed ? timeoutMs : 0);
    const readDom = () => page.evaluate(() => window.__overview.read());
    // One comparison: kubectl, the page, kubectl again. A reading whose cluster moved in between says so and is read again.
    const compared = async () => {
      const now = Date.now();
      const before = expectedOverview({ ...(await oracleOverview(kubeconfig)), ...facts, now });
      const reading = readOverview(await readDom());
      const after = expectedOverview({ ...(await oracleOverview(kubeconfig)), ...facts, now });
      return { read: reading, expected: after, problems: JSON.stringify(before) === JSON.stringify(after) ? compareOverview(reading, after, identity) : ['the cluster changed while the page was read'] };
    };
    let attempts = 0;
    let result;
    do {
      attempts += 1;
      // A page that is still checking is polled without kubectl: it is compared once it has settled, and at the deadline whatever it says.
      const look = readOverview(await readDom());
      result = isSettled(look) ? await compared() : { read: look, expected: undefined, problems: ['the page has not settled'] };
      if (result.problems.length > 0 && Date.now() < deadline) {
        await page.waitForTimeout(result.expected === undefined ? 50 : 150);
      }
    } while (result.problems.length > 0 && Date.now() < deadline);

    if (result.expected === undefined) {
      result = await compared();
    }

    const { read, expected, problems } = result;

    const recorded = await page.evaluate(() => {
      window.__overview.stop();
      return { frames: window.__overview.frames, samples: window.__overview.samples() };
    });
    const frames = recorded.frames.map(({ at, count, dom }) => ({ at, count, read: readOverview(dom) }));
    const settledAt = frames.find((frame) => isSettled(frame.read))?.at;
    const seen = { samples: recorded.samples, distinct: frames.length, loading: loadingFrames(frames), settledAt };
    const broken = frames.flatMap((frame) => frameProblems(frame.read).map((problem) => `${problem} (${String(frame.at)} ms after the press)`));
    if (problems.length > 0) {
      const list = await readPage(page);
      const loaded = broken.length > 0 ? `; while it loaded: ${broken.join('; ')}` : '';
      throw new ParityError(
        'OVERVIEW_MISMATCH',
        `${problems.join('; ')}${loaded}; page status ${JSON.stringify(list.status)}; ${String(attempts)} readings in ${String(timeoutMs / 1000)} s, each settled one compared with kubectl read before and after the page${pressed ? '' : '; the window has no row for the plugin to press'}`,
        { problems, overview: read, page: list, expected, frames: seen, pressed },
      );
    }

    if (broken.length > 0) {
      throw new ParityError('OVERVIEW_LOADING', broken.join('; '), { problems: broken, overview: read, expected, frames: seen });
    }

    return { read, expected, identity, frames: seen };
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

// A Deployment deleted while its page is open (K2c-2): the check makes its own Deployment (no replicas, so no Pod), opens its page from the Deployments list, deletes it with kubectl and reads the state the page
// shows: the title `<name> was deleted` over `It no longer exists in namespace <namespace>.` (compareGone). The earlier plugin said `<name> was not found` over a body that said it was deleted. The Deployment is
// removed whatever happens, and nothing else is touched.
export async function checkDeploymentGone({ browser, baseURL, kubeconfig, deployment = goneDeployment, timeoutMs = 30_000 }) {
  const { namespace, name } = deployment;
  const gone = ['delete', 'deployment', name, '-n', namespace, '--ignore-not-found', '--wait=false'];
  await kubectl(kubeconfig, gone);
  await kubectl(kubeconfig, ['create', 'deployment', name, '-n', namespace, '--image=busybox:1.37.0', '--replicas=0']);
  let page;
  try {
    page = await openPods(browser, baseURL);
    await page.getByRole('navigation', { name: 'Kubernetes resources' }).getByRole('treeitem', { name: /^Deployments/ }).click({ timeout: timeoutMs });
    const link = page.locator(`a[href="${deploymentHref(deployment)}"]`).first();
    try {
      await link.waitFor({ timeout: timeoutMs });
    } catch {
      throw new ParityError('GONE_MISMATCH', `${namespace}/${name}: the Deployments list does not link it to its page`, { problems: ['no link'] });
    }

    await link.click();
    await page.locator('[data-detail-section=details]').waitFor({ timeout: timeoutMs });
    await kubectl(kubeconfig, gone);
    const deadline = Date.now() + timeoutMs;
    let read;
    let problems;
    do {
      await page.waitForTimeout(100);
      read = await readGone(page);
      problems = read.title === null ? ['the page does not say the Deployment is gone'] : compareGone(read, deployment);
    } while (problems.length > 0 && Date.now() < deadline);
    if (problems.length > 0) {
      throw new ParityError('GONE_MISMATCH', `${namespace}/${name}: ${problems.join('; ')}`, { problems, read });
    }
    return { read };
  } finally {
    await page?.close();
    await kubectl(kubeconfig, gone).catch(() => undefined);
  }
}

// The state of a detail page that has no object: the visible page slot's header title and the title and message of its state body.
async function readGone(page) {
  return page.evaluate(() => {
    const norm = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
    const slot = [...document.querySelectorAll('[data-page-slot]')].find((candidate) => candidate.getClientRects().length > 0) ?? document.querySelector('[data-shell-part=page]');
    const state = slot?.querySelector('[role=status]:has(> b)') ?? null;
    return {
      h1: norm(slot?.querySelector('[data-detail-part=header] h1')?.textContent) || null,
      title: state === null ? null : norm(state.querySelector(':scope > b')?.textContent),
      hint: state === null ? null : norm(state.querySelector(':scope > span')?.textContent),
    };
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

// The sort check (K3a, plugin #282): a press on a column header of a list sorts its rows. The list is opened as a person opens it (the Pods list from the window's list of plugins, the Deployments list from the
// sidebar), the header's button is pressed, and the column must say a direction (`aria-sort`, read and not assumed) and the rows on screen must stand in the order `kubectl get <kind> -A -o json` gives for that
// direction (sort.mjs: numbers as numbers, a time as its instant, a missing value last, a tie in name order); pressed again, the column must say the other direction and the rows must reverse. The cluster is read
// before and after every reading of the page (a crash-looping Pod's restart count moves under the check): a reading whose cluster moved is read again.
// Throws ParityError('SORT_FIXTURE') when the cluster cannot tell a press from none, ParityError('SORT_MISMATCH') when the page does not agree before the deadline.
export const SORT_CASES = {
  pods: {
    listEntry: undefined,
    header: 'Restarts',
    what: 'the Pods list sorted by Restarts',
    read: async (kubeconfig) => podsByRestarts(JSON.parse(await kubectl(kubeconfig, ['get', 'pods', '-A', '-o', 'json']))),
  },
  deployments: {
    listEntry: 'Deployments',
    header: 'Age',
    what: 'the Deployments list sorted by Age',
    read: async (kubeconfig) => deploymentsByAge(JSON.parse(await kubectl(kubeconfig, ['get', 'deployments', '-A', '-o', 'json']))),
  },
};

// The list on screen: the visible page slot's table (a page the keep-alive holds hidden is not read). `ariaSort` and `button` are the header's, `ids` are `namespace/name` of the rows in the order they stand (their
// `aria-rowindex`; the object a row stands for is the one its link opens), `rowCount` is how many rows the table says it holds.
async function readSortedList(page, header) {
  return page.evaluate((wanted) => {
    const norm = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
    const slot = [...document.querySelectorAll('[data-page-slot]')].find((candidate) => candidate.getClientRects().length > 0);
    const table = slot?.querySelector('table') ?? null;
    const th = [...(table?.querySelectorAll('thead th') ?? [])].find((candidate) => norm(candidate.textContent) === wanted) ?? null;
    const rows = [...(table?.querySelectorAll('tbody tr') ?? [])]
      .map((row) => {
        const href = row.querySelector('a[href^="#/kubernetes/"]')?.getAttribute('href') ?? '';
        const query = new URLSearchParams(href.split('?')[1] ?? '');
        const namespace = query.get('namespace');
        const name = query.get('name');
        return { at: Number(row.getAttribute('aria-rowindex')), id: name === null ? null : namespace === null || namespace === '' ? name : `${namespace}/${name}` };
      })
      .filter((row) => row.id !== null)
      .sort((a, b) => a.at - b.at);
    return {
      header: th !== null,
      button: th?.querySelector('button') != null,
      ariaSort: th?.getAttribute('aria-sort') ?? null,
      ids: rows.map((row) => row.id),
      rowCount: table === null ? 0 : Number(table.getAttribute('aria-rowcount')) - 1,
    };
  }, header);
}

async function settleSorted(page, spec, kubeconfig, wanted, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let read;
  let problems;
  do {
    await page.waitForTimeout(100);
    const before = await spec.read(kubeconfig);
    read = await readSortedList(page, spec.header);
    const after = await spec.read(kubeconfig);
    problems = read.rowCount < 1 || read.ids.length !== read.rowCount ? ['the list is not fully on screen'] : compareSorted({ ariaSort: read.ariaSort, ids: read.ids, before, after, wanted });
  } while (problems.length > 0 && Date.now() < deadline);
  return { read, problems };
}

export async function checkSort({ browser, baseURL, kubeconfig, kind, timeoutMs = 45_000 }) {
  const spec = SORT_CASES[kind];
  if (spec === undefined) {
    throw new Error(`no such sort case: ${String(kind)}`);
  }

  // The fixture's crash-looping Pod has restarted at least once before the Restarts column is tried: without a Pod that restarted every number is 0 and the column's order is the name's.
  const fixtureDeadline = Date.now() + 120_000;
  let items = await spec.read(kubeconfig);
  while (!sortCanBeTold(items) && Date.now() < fixtureDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    items = await spec.read(kubeconfig);
  }

  if (!sortCanBeTold(items)) {
    throw new ParityError('SORT_FIXTURE', `${spec.what}: the cluster's objects have one value in the column (or none): a press cannot be told from no press`, { items });
  }

  const page = await openPods(browser, baseURL);
  try {
    if (spec.listEntry !== undefined) {
      await page.getByRole('navigation', { name: 'Kubernetes resources' }).getByRole('treeitem', { name: new RegExp(`^${spec.listEntry}`) }).click({ timeout: timeoutMs });
    }

    const header = page.locator('[data-page-slot]:visible').first().getByRole('columnheader', { name: new RegExp(`^${spec.header}`) });
    const fail = (message, detail) => new ParityError('SORT_MISMATCH', `${spec.what}: ${message}`, detail);

    // Before any press: the list is on screen and the column has a button and is not the sort in force (the list opens on Name).
    const deadline = Date.now() + timeoutMs;
    let initial = await readSortedList(page, spec.header);
    while ((initial.rowCount < 1 || initial.ids.length !== initial.rowCount) && Date.now() < deadline) {
      await page.waitForTimeout(100);
      initial = await readSortedList(page, spec.header);
    }

    if (!initial.header || !initial.button) {
      throw fail(`the ${spec.header} header has no sort button (header ${String(initial.header)}, button ${String(initial.button)}, ${String(initial.ids.length)} rows)`, { initial });
    }

    if (initial.ariaSort !== 'none') {
      throw fail(`before any press the ${spec.header} column says aria-sort ${JSON.stringify(initial.ariaSort)}, wanted "none"`, { initial });
    }

    await header.getByRole('button').click({ timeout: timeoutMs });
    const first = await settleSorted(page, spec, kubeconfig, undefined, timeoutMs);
    if (first.problems.length > 0) {
      throw fail(`first press: ${first.problems.join('; ')}`, { initial, first: first.read });
    }

    const direction = directionOf(first.read.ariaSort);
    await header.getByRole('button').click({ timeout: timeoutMs });
    const second = await settleSorted(page, spec, kubeconfig, opposite(direction), timeoutMs);
    if (second.problems.length > 0) {
      throw fail(`second press (after ${direction}): ${second.problems.join('; ')}`, { initial, first: first.read, second: second.read });
    }

    return { initial, first: { direction, ids: first.read.ids }, second: { direction: directionOf(second.read.ariaSort), ids: second.read.ids }, header: spec.header };
  } finally {
    await page.close();
  }
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

// S1-host: the RATE on the Logs strip of a busy Pod. The Pod is made for the check (`LOGS_BUSY`: two containers, each with a backlog of 3,000 lines at once and then 5 lines a second, never ending; logs.mjs); its page is opened from the list as a person opens
// it, the header's Logs command is pressed, and the strip's text is recorded in the page every 250 ms from that press until it has told a rate in TELLING_SAMPLES samples (or the deadline passes, which only a source that
// never says its backlog is delivered reaches). The session replays the Pod's latest 1,000 lines before its live ones: the strip must never read above twice the rate the Pod makes, and must settle near it (logs.mjs,
// `compareRate`). This is the one check that runs the whole chain: the plugin counts the lines at the head of its stream, the SDK flags them and says when the last is delivered, the host's lane asks for it and hands it on,
// the runtime keeps each source's state, and the strip counts only what the source says is live. Without the markers the strip says no rate for ever and this check fails on it. The Pod is the check's own, as the press-twice one.
// Throws ParityError('LOGS_RATE') with what `compareRate` found.
export async function checkLogsRate(options) {
  const { kubeconfig } = options;
  const pod = LOGS_BUSY;
  const at = ['-n', pod.namespace];
  return withOwnedPod(
    {
      pod,
      exists: async () => (await kubectl(kubeconfig, ['get', 'pod', pod.name, ...at, '--ignore-not-found', '-o', 'name'])).trim() !== '',
      create: async () => {
        // A Pod of two containers cannot be made by `kubectl run`: its manifest goes through a file of the check's own, which is removed whatever happens.
        const directory = await mkdtemp(path.join(os.tmpdir(), 'logs-busy-'));
        try {
          const file = path.join(directory, 'pod.json');
          await writeFile(file, JSON.stringify(busyPod(pod)));
          await kubectl(kubeconfig, ['apply', '-f', file]);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
      remove: () => kubectl(kubeconfig, ['delete', 'pod', pod.name, ...at, '--ignore-not-found', '--grace-period=0', '--force', '--wait=false']),
    },
    () => readRate(options),
  );
}

// The part of the rate case that needs the Pod to be there: wait for it, press its Logs command with a recorder already armed in the page (it starts at the click event, in the capture phase, so the first sample is the press's own),
// and read the recorder until the strip has told a rate in TELLING_SAMPLES samples. A time is only a deadline here: the verdict is on the samples.
async function readRate({ browser, baseURL, kubeconfig, timeoutMs = 90_000 }) {
  const pod = LOGS_BUSY;
  await kubectl(kubeconfig, ['wait', '--for=condition=Ready', `pod/${pod.name}`, '-n', pod.namespace, `--timeout=${String(READY_SECONDS)}s`], { timeoutMs: waitProcessMs(READY_SECONDS) });
  let page;
  try {
    page = await openPods(browser, baseURL, { timezoneId: 'UTC' });
    const link = page.locator(`a[href="${detailHref(pod)}"]`).first();
    await link.waitFor({ timeout: timeoutMs });
    await link.click();
    const logs = page.getByRole('button', { name: 'Logs', exact: true }).first();
    await logs.waitFor({ timeout: timeoutMs });
    await page.evaluate(() => {
      window.__strip = [];
      const read = () => document.querySelector('[role=group][aria-label="Session status"] > span[aria-live]')?.textContent ?? '';
      document.addEventListener(
        'click',
        () => {
          window.__timer = setInterval(() => window.__strip.push(read()), 250);
        },
        { capture: true, once: true },
      );
    });
    await logs.click({ timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    let texts = [];
    do {
      await page.waitForTimeout(500);
      texts = await page.evaluate(() => window.__strip);
    } while (texts.filter((text) => typeof readStrip(text).rate === 'number').length < TELLING_SAMPLES && Date.now() < deadline);
    await page.evaluate(() => clearInterval(window.__timer));
    // The samples before the strip is on screen are '' and say nothing: the series starts with the strip.
    const samples = texts.filter((text) => text !== '');
    const problems = compareRate(samples, { perSecond: busyRate(pod), replayed: busyReplayed(pod) });
    if (problems.length > 0) {
      throw new ParityError('LOGS_RATE', `${pod.namespace}/${pod.name}: ${problems.join('; ')}`, { problems, samples });
    }

    return { samples, pod };
  } finally {
    if (page !== undefined) {
      await closeLogsTab(page).catch(() => undefined);
      await page.close().catch(() => undefined);
    }
  }
}

// The Forward port entry of a Pod's page (PF3-k8s, plugin #288). The Pod is the check's own, as the press-twice one: the fixture declares no container port, so a busybox that declares TCP 8080 is made in `checkout`. Its page is
// opened from the list as a person opens it, the header's overflow menu must offer `Forward port 8080`, and its press must list a forward in the Ports tool whose mapping says where the plugin states the forward listens:
// `localhost:<port> → :8080/TCP` (the host never guesses an address). The forward is stopped from its row, and when the check fails too: a forward left running would outlive the Pod.
// Throws ParityError('FORWARD_MISMATCH') when the entry is absent (a plugin before #288 has none) or the row says anything else.
const FORWARD_POD = { namespace: 'checkout', name: 'forward-port' };
const FORWARD_MAPPING = /^localhost:\d+ → :8080\/TCP$/;

export async function checkForward({ browser, baseURL, kubeconfig, timeoutMs = 60_000 }) {
  const pod = FORWARD_POD;
  const at = ['-n', pod.namespace];
  return withOwnedPod(
    {
      exists: async () => (await kubectl(kubeconfig, ['get', 'pod', pod.name, ...at, '--ignore-not-found', '-o', 'name'])).trim() !== '',
      create: () => kubectl(kubeconfig, ['run', pod.name, ...at, '--image=busybox:1.37.0', '--restart=Never', '--port=8080', '--', 'sleep', '3600']),
      remove: () => kubectl(kubeconfig, ['delete', 'pod', pod.name, ...at, '--ignore-not-found', '--grace-period=0', '--force', '--wait=false']),
    },
    async () => {
      await kubectl(kubeconfig, ['wait', '--for=condition=Ready', `pod/${pod.name}`, ...at, `--timeout=${String(READY_SECONDS)}s`], { timeoutMs: waitProcessMs(READY_SECONDS) });
      const page = await openPods(browser, baseURL);
      const mapping = page.locator('[data-ports-part="mapping"]');
      try {
        const link = page.locator(`a[href="${detailHref(pod)}"]`).first();
        await link.waitFor({ timeout: timeoutMs });
        await link.click();
        await page.getByRole('button', { name: /^More actions for / }).first().click({ timeout: timeoutMs });
        const entry = page.getByRole('menuitem', { name: 'Forward port 8080' });
        await entry.waitFor({ timeout: 10_000 }).catch(() => {
          throw new ParityError('FORWARD_MISMATCH', `${pod.namespace}/${pod.name}: the Pod page's menu has no Forward port 8080 entry`, { pod });
        });
        await entry.click();
        await mapping.waitFor({ timeout: timeoutMs });
        const read = (await mapping.textContent()) ?? '';
        if (!FORWARD_MAPPING.test(read)) {
          throw new ParityError('FORWARD_MISMATCH', `${pod.namespace}/${pod.name}: the Ports tool lists ${JSON.stringify(read)}, not localhost:<port> → :8080/TCP`, { read });
        }

        return { read, pod };
      } finally {
        await page.locator('[data-ports-action="stop"]').first().click({ timeout: 2_000 }).then(() => mapping.waitFor({ state: 'detached', timeout: 15_000 })).catch(() => undefined);
        await page.close().catch(() => undefined);
      }
    },
  );
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

// INV4 (plugin omniview-plugin-kubernetes#281, the demo's finding O2). The host's account of one connection's facts, asked as the page asks (`ServiceWrapper.GetConnectionMetadata` of the resource service): the envelope the runtime's
// `useConnectionMetadata` reads, `{ supported, transportAvailable, snapshot: { entries: { <fact>: { state, value } } } }` (backend/pkg/plugin/resource/connection_metadata.go).
export async function readConnectionMetadata(baseURL, connectionID, pluginID = KUBERNETES_PLUGIN_ID) {
  const response = await fetch(new URL('/wails/runtime', baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wails-client-id': 'pods-check' },
    body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `pods-metadata-${String(Date.now())}`, methodName: `${RESOURCE_SERVICE}.GetConnectionMetadata`, args: [pluginID, connectionID] } }),
  });
  if (!response.ok) {
    throw new Error(`the facts of the connection ${connectionID} of ${pluginID} could not be read: ${String(response.status)} ${await response.text()}`);
  }

  return response.json();
}

// The requests a page makes that the host refuses (status 400 or more), each with what was asked and what the host answered, in the way the seam check records them (ui-next/plugins/e2e/seam.check.mjs, `watchRequests`). It is attached to
// the page before the plugin's page is opened, so the first request of the first load is seen. The bodies are read in the background: `settled()` waits for them, and a check calls it before it closes the page.
function recordRequests(page) {
  const failures = [];
  const bodies = [];
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }
    const request = response.request();
    const failure = { status: response.status(), method: request.method(), path: new URL(response.url()).pathname, asked: String(request.postData() ?? '').slice(0, 400), answered: '' };
    failures.push(failure);
    bodies.push(
      response.text().then(
        (body) => {
          failure.answered = body.slice(0, 400);
        },
        () => undefined,
      ),
    );
  });
  return { failures, settled: () => Promise.all(bodies.splice(0)) };
}

// The cluster's own account of the API group that cannot answer: what `kubectl get apiservice` prints of its Available condition (unavailable.mjs), or `undefined` when the cluster has no such APIService.
async function readAvailability(kubeconfig) {
  try {
    return await kubectl(kubeconfig, ['get', 'apiservice', APISERVICE, '-o', `jsonpath=${AVAILABLE_JSONPATH}`]);
  } catch (error) {
    // kubectl says NotFound on its stderr and exits 1 when there is no such APIService. Anything else (no cluster, a refused credential) is a failure of the check itself and is not hidden as an absent group.
    if (/\(NotFound\)/.test(String(error?.stderr ?? ''))) {
      return undefined;
    }
    throw error;
  }
}

// INV4: a host whose plugin connects to a cluster that has an API group that cannot answer (unavailable-group.yaml: an APIService whose Service has no endpoints, Available=False, registered BEFORE the plugin connects, which is how
// the demo met it with a metrics-server that was down). Before plugin #281 the first Pods page of such a connection failed, "Connection admission requires complete discovered support.", and Retry worked. Now:
//   the page, opened from the plugin list and never helped by a press on Retry, lists the Pods `kubectl get pods -A` lists               ParityError PAGE_MISMATCH
//   no request the page made was refused by the host (its own cancelled query apart, unavailable.mjs)                                    ParityError REQUEST_REFUSED
//   the host's facts for the connection name the group: `kubernetes.unavailable_api_groups` (read as the page's hook reads it)          ParityError FACT_MISMATCH
// and before any of it, the cluster must hold the group (GROUP_MISSING: the control that runs on a cluster without it) and the fixture (FIXTURE_MISSING). When the page fails to agree, the requests the host refused are in its message.
export async function checkUnavailableGroup({ browser, baseURL, kubeconfig, timeoutMs = 45_000, factsMs = 15_000 }) {
  const absent = compareAvailability(await readAvailability(kubeconfig));
  if (absent.length > 0) {
    throw new ParityError('GROUP_MISSING', `the cluster lacks the API group that cannot answer: ${absent.join('; ')}`, { absent });
  }
  const oracle = (await oracleRows(kubeconfig)).map((row) => row.name);
  const gaps = fixtureGaps(oracle);
  if (gaps.length > 0) {
    throw new ParityError('FIXTURE_MISSING', `the cluster lacks the fixture: ${gaps.join('; ')}`, { gaps, oracle });
  }

  const page = await openWindow(browser, baseURL);
  const requests = recordRequests(page);
  try {
    if (await openPluginPage(page)) {
      await choosePods(page);
    }

    let agreed;
    try {
      agreed = await agreeWithKubectl(page, kubeconfig, timeoutMs);
    } catch (error) {
      await requests.settled();
      const refused = refusedRequests(requests.failures);
      if (!(error instanceof ParityError) || refused.length === 0) {
        throw error;
      }
      throw new ParityError(error.code, `${error.message.slice(error.code.length + 2)}; requests the host refused: ${refused.join(' | ')}`, { ...error.detail, refused });
    }
    await requests.settled();
    const refused = refusedRequests(requests.failures);
    if (refused.length > 0) {
      throw new ParityError('REQUEST_REFUSED', `the page's first load made requests the host refused: ${refused.join(' | ')}`, { refused });
    }
    // What the check let through: the page's own cancelled queries (unavailable.mjs). The test reports how many, so that a run says whether the allowance was used.
    const cancelled = requests.failures.length - refused.length;

    const { context, id } = await expectedLane({ baseURL, kubeconfig });
    if (id === undefined || id === '') {
      throw new ParityError('FACT_MISMATCH', `the host lists no connection for the context ${JSON.stringify(context)}, so its facts cannot be read`, { context });
    }
    const deadline = Date.now() + factsMs;
    for (;;) {
      const facts = await readConnectionMetadata(baseURL, id);
      const problems = compareFacts(facts);
      if (problems.length === 0) {
        return { ...agreed, facts, connectionID: id, cancelled };
      }
      if (Date.now() >= deadline) {
        throw new ParityError('FACT_MISMATCH', problems.join('; '), { problems, facts, connectionID: id });
      }
      await page.waitForTimeout(500);
    }
  } finally {
    await page.close();
  }
}
