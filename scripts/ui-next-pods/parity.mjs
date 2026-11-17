import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { converge } from './agreement.mjs';
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

// The window as the native app opens it: `/`, no `?screen=`, no hash, no connection. What it shows is the plugin's page, named by the plugin's contribution.
export async function openPods(browser, baseURL) {
  const page = await browser.newPage({ viewport: WINDOW });
  await page.goto(new URL('/', baseURL).href);
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
