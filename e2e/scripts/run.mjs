import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { applicationBudget, assertStandaloneBootstrap, repositoryCommit, toolEnvironment } from './execution.mjs';
import { cohortMatches, selectFromGit } from './select-tests.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const started = Date.now();
const phases = [];
let privateRoot;
let selection;
let operation;
let sourceRefs;
let deadlineBudget;
let env = toolEnvironment(process.env);
function execute(command, args, { capture = false, timeout = 180_000, extraEnv = {}, cwd = root } = {}) {
  const remaining = 600_000 - (Date.now() - started);
  if (timeout !== 0 && remaining <= 0) throw Error('Inclusive E2E budget exhausted');
  const child = spawnSync(command, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', timeout: timeout === 0 ? undefined : Math.min(timeout, remaining), maxBuffer: 16 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw Error(`${command} failed on its first attempt (${child.error?.code ?? child.status})`);
  return capture ? child.stdout.trim() : '';
}
function phase(name, fn) {
  const start = Date.now();
  try { return fn(); } finally { phases.push({ name, elapsedMs: Date.now() - start }); }
}
function git(source, ...args) {
  return execFileSync('git', ['-C', source, ...args], { env, encoding: 'utf8', timeout: Math.max(1, Math.min(30_000, 600_000 - (Date.now() - started))), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim();
}
function options(args) {
  const result = { full: true, base: process.env.OMNIVIEW_E2E_BASE };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--full') result.full = true;
    else if (arg === '--changed') result.full = false;
    else if (arg === '--base' && args[i + 1]) result.base = args[++i];
    else if (arg === '--list') result.list = true;
    else if (arg === '--ui') result.ui = true;
    else if (arg === '--observe') result.observe = true;
    else if (arg === '--report') result.report = true;
    else throw Error(`Unsupported argument: ${arg}. Use --full, --changed --base REF, --list, --ui, --observe, or --report.`);
  }
  if (args.includes('--full')) result.full = true;
  if (result.observe && !result.full) throw Error('Observation cannot use changed-file selection');
  return result;
}
function cohortUnchanged(base, cohort) {
  if (!base || !cohort) return false;
  try {
    const ancestor = git(root, 'merge-base', base, 'HEAD');
    const previous = JSON.parse(git(root, 'show', `${ancestor}:e2e/source-cohort.json`));
    // This file is only a selection sentinel, not a source authority. A new
    // explicit compatible cohort runs FULL and still undergoes genuine probes.
    const actual = Object.fromEntries(['plugin-sdk', 'ui', 'kubernetes'].map(id => {
      const source = id === 'plugin-sdk' ? (process.env.SDK_SOURCE ?? join(root, '..', id)) : id === 'ui' ? (process.env.UI_SOURCE ?? join(root, '..', id)) : (process.env.KUBERNETES_SOURCE ?? join(root, 'plugins/kubernetes'));
      if (git(source, 'status', '--porcelain', '--untracked-files=all')) throw Error('Source cohort has uncommitted changes');
      return [id, repositoryCommit(source, env)];
    }));
    return cohortMatches({ current: cohort, baseline: previous, actual });
  } catch { return false; }
}
const playwrightCLI = () => {
  try { return createRequire(join(root, 'e2e/package.json')).resolve('@playwright/test/cli'); } catch {
    throw Error('Playwright is not installed: real standalone E2E runs install its pinned dependencies; for discovery use an already prepared canonical dependency context, never an ambient pnpm exec install');
  }
};
function main() {
  const opts = options(process.argv.slice(2));
  operation = opts.report ? 'report' : opts.list ? 'discovery' : opts.observe ? 'observation' : 'application';
  if (opts.report) {
    execute(process.execPath, [playwrightCLI(), 'show-report'], { cwd: join(root, 'e2e'), timeout: 0 });
    return;
  }
  let cohort;
  try { cohort = JSON.parse(readFileSync(join(root, 'e2e/source-cohort.json'), 'utf8')); } catch { /* Missing sentinel forces full, never another cohort. */ }
  selection = opts.observe ? { kind: 'observe', groups: ['observation'], specs: ['tests/observation'], reasons: ['explicit read-only opt-in'] } : selectFromGit({ root, base: opts.base, full: opts.full, cohortUnchanged: !opts.full && cohortUnchanged(opts.base, cohort), env });
  console.log(`E2E selection: ${JSON.stringify(selection)}`);
  if (selection.kind === 'none') return;
  const playwrightArgs = ['test', ...selection.specs];
  if (opts.list) {
    // Direct Node CLI discovery never invokes a package manager or prepares hosts.
    env.OMNIVIEW_E2E_MODE = opts.observe ? 'observe' : 'owned';
    execute(process.execPath, [playwrightCLI(), ...playwrightArgs, '--list'], { cwd: join(root, 'e2e') });
    return;
  }
  if (opts.observe) {
    env.OMNIVIEW_E2E_MODE = 'observe';
    for (const key of ['OMNIVIEW_E2E_CLI', 'OMNIVIEW_E2E_ROOT', 'OMNIVIEW_E2E_WORKSPACE', 'OMNIVIEW_E2E_WORKSPACE_ID', 'OMNIVIEW_E2E_GENERATION']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    execute(process.execPath, [playwrightCLI(), ...playwrightArgs, '--global-timeout', '600000', ...(opts.ui ? ['--ui'] : [])], { cwd: join(root, 'e2e'), timeout: 0 });
    return;
  }
  // A single invocation owns ALL preparation and browser work. No retry loop,
  // setup job, prebuilt host, force-peer override, or fabricated link evidence.
  assertStandaloneBootstrap(root);
  const sources = {
    omniview: realpathSync(root),
    'plugin-sdk': realpathSync(resolve(process.env.SDK_SOURCE ?? join(root, '..', 'plugin-sdk'))),
    ui: realpathSync(resolve(process.env.UI_SOURCE ?? join(root, '..', 'ui'))),
    kubernetes: realpathSync(resolve(process.env.KUBERNETES_SOURCE ?? join(root, 'plugins/kubernetes'))),
  };
  const refs = Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, repositoryCommit(source, env)]));
  sourceRefs = refs;
  for (const id of Object.keys(sources)) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(refs[id])) throw Error(`Selected ${id} has no immutable source commit`);
    if (git(sources[id], 'status', '--porcelain', '--untracked-files=all')) throw Error(`Selected ${id} has uncommitted source edits; commit intended source before running owned E2E`);
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(process.env.REVIEWED_SDK_REVISION ?? '') || process.env.REVIEWED_SDK_REVISION !== refs['plugin-sdk']) throw Error('Set REVIEWED_SDK_REVISION to the independently reviewed full selected SDK commit');
  privateRoot = realpathSync(mkdtempSync(join(tmpdir(), 'omniview-e2e-')));
  const home = join(privateRoot, 'home');
  mkdirSync(home, { mode: 0o700 });
  env = { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), GOPATH: join(home, 'go'), GOCACHE: join(home, '.cache/go-build'), SDK_SOURCE: sources['plugin-sdk'], PATH: `${join(home, 'go/bin')}${delimiter}${process.env.PATH}`, OMNIVIEW_E2E_MODE: 'owned' };
  const pnpm = env.OMNIVIEW_E2E_PNPM_EXECUTABLE ?? 'pnpm';
  if (env.OMNIVIEW_E2E_PNPM_EXECUTABLE && !isAbsolute(pnpm)) throw Error('OMNIVIEW_E2E_PNPM_EXECUTABLE must be an absolute native pnpm executable');
  phase('bootstrap-tools', () => {
    if (execute(pnpm, ['--version'], { capture: true }) !== '12.14.0') throw Error('E2E requires native pnpm 12.14.0');
    execute('bash', ['./scripts/install-wails-cli.sh']);
  });
  phase('dependency-install', () => execute(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies']));
  phase('browser-install', () => execute(process.execPath, [playwrightCLI(), 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'], { cwd: join(root, 'e2e') }));
  phase('canonical-cli-and-real-probes', () => {
    env.OMNIVIEW_E2E_CLI = execute('task', ['--silent', 'dev:cli:build', `SDK_SOURCE=${sources['plugin-sdk']}`], { capture: true });
    const hostmod = execute('task', ['--silent', 'host:prepare', `SDK_SOURCE=${sources['plugin-sdk']}`, `HOST_MOD_OUTPUT_DIRECTORY=${join(privateRoot, 'hostmod')}`], { capture: true });
    const modfile = join(privateRoot, 'probe.mod');
    copyFileSync(hostmod, modfile);
    copyFileSync(hostmod.replace(/\.mod$/, '.sum'), modfile.replace(/\.mod$/, '.sum'));
    const report = join(privateRoot, 'pinned-link-protocol.json');
    execute('go', ['test', `-modfile=${modfile}`, '-tags', 'server', './internal/devworkspace', '-run', '^TestLinkPinnedProtocolProbe$', '-count=1'], { extraEnv: { A11_PROTOCOL_PROBE: '1', A11_PROTOCOL_REPORT: report } });
    JSON.parse(readFileSync(report, 'utf8'));
    execute('go', ['test', `-modfile=${modfile}`, '-tags', 'server', './internal/devworkspace', '-run', '^TestPinnedPNPMNestedScriptProbe$', '-count=1'], { extraEnv: { A15_PINNED_PNPM_PROBE: '1' } });
    const probe = JSON.parse(execute(process.execPath, ['e2e/scripts/prepare-workspace-probe.mjs', '--destination', join(privateRoot, 'workspace-probe')], { capture: true }));
    if (probe.pluginID !== 'workspace-probe' || probe.source !== join(privateRoot, 'workspace-probe') || probe.ref !== git(probe.source, 'rev-parse', 'HEAD')) throw Error('Invalid real probe source');
    sources['workspace-probe'] = probe.source;
    refs['workspace-probe'] = probe.ref;
    env.OMNIVIEW_E2E_SOURCES = join(privateRoot, 'sources.json');
    writeFileSync(env.OMNIVIEW_E2E_SOURCES, JSON.stringify({ sources, refs, repositories: ['plugin-sdk', 'ui'], plugins: ['kubernetes', 'workspace-probe'], reviewedSDKRevision: refs['plugin-sdk'], linkEvidence: report, liveFrontend: false }), { mode: 0o600, flag: 'wx' });
  });
  for (const [id, source] of Object.entries(sources)) {
    if (git(source, 'rev-parse', 'HEAD') !== refs[id] || git(source, 'diff', '--name-only', 'HEAD', '--')) throw Error(`Selected ${id} source changed during preparation; refusing mixed committed sources`);
  }
  deadlineBudget = applicationBudget(started, Date.now());
  // Let Playwright cancel the run and execute owned fixture teardown. Never
  // SIGTERM a pnpm wrapper or infer stopped supervisors from CLI cancellation.
  phase('application-assertions-and-owned-teardown', () => execute(process.execPath, [playwrightCLI(), ...playwrightArgs, '--global-timeout', String(deadlineBudget.globalTimeoutMs), ...(opts.ui ? ['--ui'] : [])], { cwd: join(root, 'e2e'), timeout: 0 }));
  phase('preparation-teardown', () => {
    // Only this fresh private GOPATH is in scope; Go removes its own read-only
    // extracted module directories before ordinary private-root retirement.
    execute('go', ['clean', '-modcache']);
    rmSync(privateRoot, { recursive: true });
    privateRoot = undefined;
  });
}
let succeeded = false;
try { main(); succeeded = true; } catch (error) {
  console.error(`E2E: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Private sources, probe evidence and failure state stay outside upload paths.
  // Fixture teardown owns workspace down/removal; never recursively delete its
  // private arena after failure or retry the complete preparation implicitly.
  const elapsedMs = Date.now() - started;
  const budgetExceeded = operation === 'application' && elapsedMs > 600_000;
  if (budgetExceeded) {
    succeeded = false;
    process.exitCode = 1;
    console.error('E2E inclusive600s budget exceeded; owned cleanup was allowed to finish, not force-killed');
  }
  if (privateRoot) console.error(`E2E private preparation retained: ${privateRoot}`);
  const report = { succeeded, operation, elapsedMs: Date.now() - started, budgetMs: 600_000, budgetExceeded, deadlineBudget, selection, phases, sourceRefs, declaredFrontendModes: selection?.groups.includes('workspaces') ? ['optimized', 'live'] : [], retries: 0 };
  if (operation !== 'report') {
    mkdirSync(join(root, 'e2e/playwright-report'), { recursive: true });
    writeFileSync(join(root, 'e2e/playwright-report', operation === 'discovery' ? 'discovery.json' : 'invocation.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
}
