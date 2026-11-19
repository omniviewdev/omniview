import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { converge } from './agreement.mjs';
import { compareDetail, DETAIL_POD, detailHref, expectedDetail } from './detail.mjs';
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
      rowCount: table === null ? 0 : Number(table.getAttribute('aria-rowcount')) - 1,
      status: `${state ?? 'no page'}${message === '' ? '' : `: ${message}`}${count === null ? '' : ` (${count})`}`,
    };
  });
}

export async function kubectl(kubeconfig, args) {
  const { stdout } = await run('kubectl', ['--kubeconfig', kubeconfig, ...args], { encoding: 'utf8', timeout: 60_000 });
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
// be opened are listed, a plugin that did not load among them, and the rail beside them has an entry for each.
export async function openWindow(browser, baseURL) {
  await forgetSession(baseURL);
  const page = await browser.newPage({ viewport: WINDOW });
  await page.goto(new URL('/', baseURL).href);
  return page;
}

// The plugin's page, opened the way a person opens it from that window: the plugin's row in the list of plugins that can be opened. It is the same in every mode of the check: a plugin installed without its
// bundle is in the list too ("Did not load") and its row opens the page that names the failure, and a host without the plugin has no row, so the window stays at its own list of plugins (the page the
// check reads and finds wanting). What the page shows is the plugin's page, named by the plugin's contribution.
export async function openPods(browser, baseURL) {
  const page = await openWindow(browser, baseURL);
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
export async function checkDetail({ browser, baseURL, kubeconfig, pod = DETAIL_POD, timeoutMs = 30_000 }) {
  const oracle = async () => expectedDetail(JSON.parse(await kubectl(kubeconfig, ['get', 'pod', pod.name, '-n', pod.namespace, '-o', 'json'])));
  const page = await openPods(browser, baseURL);
  try {
    const link = page.locator(`a[href="${detailHref(pod)}"]`).first();
    await link.waitFor({ timeout: timeoutMs });
    await link.click();
    const deadline = Date.now() + timeoutMs;
    let read;
    let expected;
    let problems;
    do {
      await page.waitForTimeout(100);
      // Each page reading is bracketed by two reads of the Pod: a Pod replaced in between (a StatefulSet Pod keeps its name and gets a new IP) is read again, it is not a defect of the page.
      const before = await oracle();
      read = await readDetail(page);
      expected = await oracle();
      if (JSON.stringify(before) !== JSON.stringify(expected)) {
        problems = ['the Pod changed while the page was read'];
      } else {
        problems = read.h1 === null ? ['the detail page is not on screen'] : compareDetail(read, expected);
      }
    } while (problems.length > 0 && Date.now() < deadline);
    if (problems.length > 0) {
      throw new ParityError('DETAIL_MISMATCH', `${pod.namespace}/${pod.name}: ${problems.join('; ')}`, { problems, read, expected });
    }
    return { read, expected };
  } finally {
    await page.close();
  }
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
