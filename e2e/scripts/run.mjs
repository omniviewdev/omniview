import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cohortMatches, selectFromGit } from './select-tests.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const started = Date.now();
const phases = [];
let privateRoot;
let selection;
let operation;
let sourceRefs;
let env = { ...process.env, GOWORK: 'off', GOFLAGS: '' };
function execute(command, args, { capture = false, timeout = 180_000, extraEnv = {} } = {}) {
  const child = spawnSync(command, args, { cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', timeout, maxBuffer: 16 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw Error(`${command} failed on its first attempt (${child.error?.code ?? child.status})`);
  return capture ? child.stdout.trim() : '';
}
function phase(name, fn) {
  const start = Date.now();
  try { return fn(); } finally { phases.push({ name, elapsedMs: Date.now() - start }); }
}
function git(source, ...args) {
  return execFileSync('git', ['-C', source, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim();
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
    else throw Error(`Unsupported argument: ${arg}. Use --full, --changed --base REF, --list, --ui, or --observe.`);
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
    const actual = Object.fromEntries(['plugin-sdk', 'ui'].map(id => {
      const source = id === 'plugin-sdk' ? (process.env.SDK_SOURCE ?? join(root, '..', id)) : (process.env.UI_SOURCE ?? join(root, '..', id));
      return [id, git(source, 'rev-parse', 'HEAD')];
    }));
    return cohortMatches({ current: cohort, baseline: previous, actual });
  } catch { return false; }
}
function main() {
  const opts = options(process.argv.slice(2));
  operation = opts.list ? 'discovery' : opts.observe ? 'observation' : 'application';
  let cohort;
  try { cohort = JSON.parse(readFileSync(join(root, 'e2e/source-cohort.json'), 'utf8')); } catch { /* Missing sentinel forces full, never another cohort. */ }
  selection = opts.observe ? { kind: 'observe', groups: ['observation'], specs: ['tests/observation'], reasons: ['explicit read-only opt-in'] } : selectFromGit({ root, base: opts.base, full: opts.full, cohortUnchanged: cohortUnchanged(opts.base, cohort) });
  console.log(`E2E selection: ${JSON.stringify(selection)}`);
  if (selection.kind === 'none') return;
  const playwrightArgs = ['--dir', 'e2e', 'exec', 'playwright', 'test', ...selection.specs];
  if (opts.list) {
    // Discovery never builds, installs, probes, or creates owned profiles.
    env.OMNIVIEW_E2E_MODE = opts.observe ? 'observe' : 'owned';
    execute('pnpm', [...playwrightArgs, '--list']);
    return;
  }
  if (opts.observe) {
    env.OMNIVIEW_E2E_MODE = 'observe';
    execute('pnpm', [...playwrightArgs, ...(opts.ui ? ['--ui'] : [])], { timeout: 600_000 });
    return;
  }
  // A single invocation owns ALL preparation and browser work. No retry loop,
  // setup job, prebuilt host, force-peer override, or fabricated link evidence.
  const sources = {
    omniview: realpathSync(root),
    'plugin-sdk': realpathSync(resolve(process.env.SDK_SOURCE ?? join(root, '..', 'plugin-sdk'))),
    ui: realpathSync(resolve(process.env.UI_SOURCE ?? join(root, '..', 'ui'))),
    kubernetes: realpathSync(join(root, 'plugins/kubernetes')),
  };
  const refs = Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, git(source, 'rev-parse', 'HEAD')]));
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
  phase('bootstrap-tools', () => {
    if (execute('pnpm', ['--version'], { capture: true }) !== '12.14.0') throw Error('E2E requires native pnpm 12.14.0');
    execute('bash', ['./scripts/install-wails-cli.sh']);
  });
  phase('dependency-install', () => execute('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies']));
  phase('browser-install', () => execute('pnpm', ['--dir', 'e2e', 'exec', 'playwright', 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium']));
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
  phase('application-assertions-and-owned-teardown', () => execute('pnpm', [...playwrightArgs, ...(opts.ui ? ['--ui'] : [])], { timeout: 600_000 }));
}
let succeeded = false;
try { main(); succeeded = true; } catch (error) {
  console.error(`E2E: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Private sources, probe evidence and failure state stay outside upload paths.
  // Fixture teardown owns workspace down/removal; never recursively delete its
  // private arena after failure or retry the complete preparation implicitly.
  if (privateRoot && succeeded) rmSync(privateRoot, { recursive: true });
  else if (privateRoot) console.error(`E2E private preparation retained: ${privateRoot}`);
  const report = { succeeded, operation, elapsedMs: Date.now() - started, selection, phases, sourceRefs, declaredFrontendModes: selection?.groups.includes('workspaces') ? ['optimized', 'live'] : [], retries: 0 };
  mkdirSync(join(root, 'e2e/playwright-report'), { recursive: true });
  writeFileSync(join(root, 'e2e/playwright-report/invocation.json'), `${JSON.stringify(report, null, 2)}\n`);
}
