// Shared helpers of pods-page.probe.mjs: Playwright engines, the kubectl read, the status classification, the reporter, and the
// in-page helpers (role, accessible name, description of an element) the probe installs in every document.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const pw = createRequire(import.meta.url)('playwright');

export const ENGINES = { webkit: pw.webkit, chromium: pw.chromium };
export const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1030x720': { width: 1030, height: 720 } };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------------------
// Reporter: one line per assertion.
export const results = [];
export function check(scope, name, ok, measured) {
  const value = measured === undefined ? '' : ` -- ${typeof measured === 'string' ? measured : JSON.stringify(measured)}`;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${value}`);
  results.push({ scope, name, ok: Boolean(ok), measured });
  return ok;
}
export function info(scope, name, data) {
  console.log(`INFO [${scope}] ${name} -- ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  results.push({ scope, name, info: true, data });
}

// ---------------------------------------------------------------------------------------------------------------------------
// kubectl (read only) and the plan's classification of a STATUS word.
const KUBECONFIG = process.env.KUBECONFIG_PATH ?? '/tmp/ov-1a6-env/kubeconfig';

export function readKube() {
  const out = execFileSync('kubectl', ['--kubeconfig', KUBECONFIG, 'get', 'pods', '-A', '--no-headers'], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.trim()).map((line) => {
    const cols = line.trim().split(/\s+/);
    return { namespace: cols[0], name: cols[1], ready: cols[2], status: cols[3], key: `${cols[0]}/${cols[1]}` };
  });
}

const PENDING = /^(Pending|ContainerCreating|PodInitializing|Terminating|Init:\d+\/\d+)$/;
const FAILED = new Set([
  'CrashLoopBackOff', 'Error', 'Failed', 'ImagePullBackOff', 'ErrImagePull', 'ErrImageNeverPull', 'OOMKilled', 'Evicted', 'NotReady',
  'CreateContainerConfigError', 'CreateContainerError', 'InvalidImageName', 'RunContainerError', 'ContainerCannotRun', 'DeadlineExceeded',
  'RegistryUnavailable', 'ContainerStatusUnknown', 'NodeLost', 'Shutdown', 'UnexpectedAdmissionError', 'OutOfcpu', 'OutOfmemory',
]);

/** 'running' | 'pending' | 'failed' | 'completed'; throws on a word this probe cannot classify. */
export function classify(status) {
  if (status === 'Running') return 'running';
  if (status === 'Completed' || status === 'Succeeded') return 'completed';
  if (PENDING.test(status)) return 'pending';
  if (FAILED.has(status) || /^Init:(Error|CrashLoopBackOff|ImagePullBackOff|ErrImagePull|OOMKilled|.*Error)$/.test(status) || /(Error|BackOff)$/.test(status)) return 'failed';
  throw new Error(`cannot classify kubectl STATUS "${status}"`);
}

export function tally(kube) {
  const t = { all: kube.length, running: 0, pending: 0, failed: 0, completed: 0 };
  for (const pod of kube) t[classify(pod.status)] += 1;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------------
export function findAxe() {
  const candidates = [process.env.AXE, '/tmp/ov-axe/node_modules/axe-core/axe.min.js', '/tmp/axe-core/node_modules/axe-core/axe.min.js', '/tmp/atoms/axe/node_modules/axe-core/axe.min.js'];
  const found = candidates.find((p) => p && existsSync(p));
  return found ? { path: found, source: readFileSync(found, 'utf8') } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------
/** Installed in every document (addInitScript): window.__p.{describe, tabStops, text}. Self-contained: it runs in the page. */
export function installHelpers() {
  const text = (n) => (n.textContent || '').replace(/\s+/g, ' ').trim();
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'INPUT') return { search: 'searchbox', text: 'textbox', checkbox: 'checkbox' }[el.type] ?? 'textbox';
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : 'generic';
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'TABLE') return 'table';
    if (tag === 'TR') return 'row';
    return tag.toLowerCase();
  };
  const nameOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ');
    const label = el.getAttribute('aria-label');
    if (label) return label;
    if (el.labels && el.labels[0]) return text(el.labels[0]);
    if (['BUTTON', 'A', 'H1', 'H2', 'H3'].includes(el.tagName) || el.getAttribute('role') === 'button') return text(el);
    return el.getAttribute('placeholder') || '';
  };
  const describedBy = (el) => {
    const ids = el.getAttribute('aria-describedby');
    if (ids) return ids.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ');
    return el.getAttribute('aria-description') || '';
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const describe = (el) => {
    const page = document.querySelector('[role=tabpanel]');
    if (!el || el === document.body || el === document.documentElement) return { role: 'document', name: '', tag: 'body', inPage: false };
    return {
      role: roleOf(el), name: nameOf(el), tag: el.tagName.toLowerCase(), inPage: Boolean(page && page.contains(el)),
      pressed: el.getAttribute('aria-pressed'), ariaDisabled: el.getAttribute('aria-disabled'), disabled: el.disabled === true,
      description: describedBy(el), tabindex: el.getAttribute('tabindex'),
    };
  };
  const tabStops = () => {
    const page = document.querySelector('[role=tabpanel]');
    return [...page.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !el.disabled && visible(el))
      .map(describe);
  };
  window.__p = { describe: (el) => describe(el), tabStops, text, roleOf, nameOf, visible };
}
