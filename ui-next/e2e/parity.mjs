import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { diffNames, fixtureGaps, isAgreement, ParityError, parseKubectlPods } from './oracle.mjs';

const run = promisify(execFile);

// The page's side of the contract. The only place that knows the page's markup: the skeleton's `pods-status` line and one `pod-name`
// element per row holding `namespace/name`. PR 1a.2 and 1a.7 change the page; they change this function, not the checks around it.
export async function readPage(page) {
  return page.evaluate(() => ({
    status: document.querySelector('[data-testid=pods-status]')?.textContent ?? null,
    names: [...document.querySelectorAll('[data-testid=pod-name]')].map((element) => element.textContent ?? '').sort(),
  }));
}

export async function kubectl(kubeconfig, args) {
  const { stdout } = await run('kubectl', ['--kubeconfig', kubeconfig, ...args], { encoding: 'utf8', timeout: 60_000 });
  return stdout;
}

// The oracle: kubectl's own answer, never read from the page or from the fixture file.
export async function oraclePods(kubeconfig) {
  return parseKubectlPods(await kubectl(kubeconfig, ['get', 'pods', '-A', '--no-headers', '-o', 'custom-columns=NS:.metadata.namespace,NAME:.metadata.name']));
}

export async function launchBrowser() {
  return chromium.launch();
}

export async function openPods(browser, baseURL) {
  const page = await browser.newPage();
  await page.goto(new URL('/?screen=pods', baseURL).href);
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

// The check: the cluster holds the fixture, and the page at `?screen=pods` lists exactly the Pods `kubectl get pods -A` lists.
// Throws ParityError('FIXTURE_MISSING') when the cluster is empty of the fixture, ParityError('PAGE_MISMATCH') when the page disagrees.
export async function checkParity({ browser, baseURL, kubeconfig, timeoutMs = 30_000 }) {
  const oracle = await oraclePods(kubeconfig);
  const gaps = fixtureGaps(oracle);
  if (gaps.length > 0) {
    throw new ParityError('FIXTURE_MISSING', `the cluster lacks the fixture: ${gaps.join('; ')}`, { gaps, oracle });
  }

  const page = await openPods(browser, baseURL);
  try {
    const read = await settle(page, (current) => isAgreement(diffNames(current.names, oracle)), timeoutMs);
    const diff = diffNames(read.names, oracle);
    if (!isAgreement(diff)) {
      throw new ParityError(
        'PAGE_MISMATCH',
        `the page lists ${String(read.names.length)} Pods, kubectl lists ${String(oracle.length)}; page status ${JSON.stringify(read.status)}; missing ${String(diff.missing.length)}, extra ${String(diff.extra.length)}, duplicated ${String(diff.duplicated.length)}`,
        { diff, status: read.status, pageNames: read.names, oracle },
      );
    }
    return { oracle, status: read.status };
  } finally {
    await page.close();
  }
}
