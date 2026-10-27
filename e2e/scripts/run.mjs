import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { applicationBudget, assertStandaloneBootstrap, commandTimeout, preparationStarted, repositoryCommit, runnerOptions, toolEnvironment } from './execution.mjs';
import { cohortMatches, selectFromGit } from './select-tests.mjs';
import { discoveredSpecs, forceRegExp, prepareApplication, requiresApplication, startApplicationBroker } from './application.mjs';
import { retireApplicationCohort } from './cohort.mjs';
import { initializeToolCache, readToolCache, retirePreparationHome } from './tool-cache.mjs';
import { preparePinnedWailsTool } from '../../scripts/wails-tool.mjs';
import { prepareLinuxDependencies } from './browser-dependencies.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const processStarted = Date.now();
let started = processStarted;
const phases = [];
let privateRoot;
let selection;
let operation;
let sourceRefs;
let deadlineBudget;
let launchBroker;
let launchDrain;
let toolCache;
let linuxDependencies;
let buildExecution;
let interactive = false;
let env = toolEnvironment(process.env);
function execute(command, args, { capture = false, timeout = 180_000, extraEnv = {}, cwd = root, acceptedExitCodes = [0] } = {}) {
  const boundedTimeout = commandTimeout(started, Date.now(), timeout, interactive);
  const child = spawnSync(command, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', capture === 'result' ? 'pipe' : 'inherit'] : 'inherit', timeout: boundedTimeout, maxBuffer: 16 * 1024 * 1024 });
  if (child.error || !acceptedExitCodes.includes(child.status)) throw Error(`${command} failed on its first attempt (${child.error?.code ?? child.status})`);
  if (capture === 'result') return { stdout: child.stdout.trim(), stderr: child.stderr.trim(), status: child.status };
  return capture ? child.stdout.trim() : '';
}
function phase(name, fn) {
  const start = Date.now();
  try { return fn(); } finally { phases.push({ name, elapsedMs: Date.now() - start }); }
}
async function runApplication(args) {
  const start = Date.now();
  try {
    deadlineBudget = applicationBudget(started, Date.now(), { interactive });
    const outcome = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [playwrightCLI(), ...args, '--global-timeout', '0', '--reporter=html,list,./scripts/timing-reporter.mjs'], { cwd: join(root, 'e2e'), env, stdio: 'inherit' });
      let interrupted = false;
      const interrupt = () => {
        if (!interrupted) {
          interrupted = true;
          // Fence and begin draining launch handles at shutdown admission, not
          // only after a potentially disconnected worker has exited.
          if (!interactive) void launchBroker?.closeAndDrain().catch(() => {});
          child.kill('SIGINT');
        }
      };
      // First SIGINT with an unbounded Playwright deadline awaits dispatcher and
      // fixture shutdown. Parent ownership recovery also covers worker loss.
      const timer = deadlineBudget ? setTimeout(interrupt, deadlineBudget.interruptAfterMs) : undefined;
      process.on('SIGINT', interrupt);
      const clear = () => { clearTimeout(timer); process.off('SIGINT', interrupt); };
      child.once('error', () => { clear(); reject(Error('Playwright could not start')); });
      child.once('close', (code, signal) => { clear(); resolve({ code, signal, interrupted }); });
    });
    const closedInteractive = interactive && outcome.interrupted && (outcome.code === 130 || outcome.signal === 'SIGINT');
    if ((outcome.code !== 0 && !closedInteractive) || (outcome.interrupted && !interactive)) throw Error('Playwright failed or reached its inclusive assertion deadline on the first attempt');
  } finally {
    phases.push({ name: 'application-assertions-and-worker-teardown', elapsedMs: Date.now() - start });
    // IPC disconnect/worker crash cannot bypass ownership cleanup. This journal
    // is coordinator data, never a managed receipt or a replacement for inspect.
    const drainStarted = Date.now();
    try { launchDrain = await launchBroker?.closeAndDrain(); } finally { phases.push({ name: 'owned-launch-drain', elapsedMs: Date.now() - drainStarted }); }
  }
}
function git(source, ...args) {
  return execFileSync('git', ['-C', source, ...args], { env, encoding: 'utf8', timeout: commandTimeout(started, Date.now(), 30_000, interactive), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim();
}
function sourceLocations() {
  return {
    omniview: root,
    'plugin-sdk': resolve(process.env.SDK_SOURCE ?? join(root, '..', 'plugin-sdk')),
    ui: resolve(process.env.UI_SOURCE ?? join(root, '..', 'ui')),
    kubernetes: resolve(process.env.KUBERNETES_SOURCE ?? join(root, 'plugins/kubernetes')),
  };
}
function cacheProtectedRoots(sources, preparationRoot) {
  const protectedRoots = [...Object.values(sources)];
  if (preparationRoot) protectedRoots.push(preparationRoot);
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) for (const name of ['.omniview', '.omniview-nightly', '.omniview-dev']) protectedRoots.push(join(home, name));
  return protectedRoots;
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
async function main() {
  const opts = runnerOptions(process.argv.slice(2));
  if (opts.grep) forceRegExp(opts.grep);
  if (opts.initToolCache) {
    operation = 'cache-initialization';
    assertStandaloneBootstrap(root);
    if (!process.env.OMNIVIEW_E2E_TOOL_CACHE_ROOT) throw Error('OMNIVIEW_E2E_TOOL_CACHE_ROOT must explicitly select a fresh or previously initialized private cache');
    toolCache = initializeToolCache(process.env.OMNIVIEW_E2E_TOOL_CACHE_ROOT, { protectedRoots: cacheProtectedRoots(sourceLocations()) });
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `OMNIVIEW_E2E_TOOL_CACHE_ROOT=${toolCache.root}\nGOCACHE=${toolCache.bootstrapGoCache}\nGOMODCACHE=${toolCache.goModCache}\nPLAYWRIGHT_BROWSERS_PATH=${toolCache.playwrightBrowsers}\n`);
    console.log('E2E native tool-cache container initialized; only native cache payloads may be restored');
    return;
  }
  operation = opts.cacheOnly ? 'cache-only' : opts.report ? 'report' : opts.select ? 'selection' : opts.list ? 'discovery' : opts.observe ? 'observation' : 'application';
  if (opts.cacheOnly && !process.env.OMNIVIEW_E2E_TOOL_CACHE_ROOT) throw Error('--cache-only requires OMNIVIEW_E2E_TOOL_CACHE_ROOT for explicit owned native payloads');
  interactive = Boolean(opts.ui && !opts.list && !opts.select);
  if (opts.report) {
    execute(process.execPath, [playwrightCLI(), 'show-report'], { cwd: join(root, 'e2e'), timeout: 0 });
    return;
  }
  let cohort;
  try { cohort = JSON.parse(readFileSync(join(root, 'e2e/source-cohort.json'), 'utf8')); } catch { /* Missing sentinel forces full, never another cohort. */ }
  selection = opts.cacheOnly ? { kind: 'cache-only', groups: [], specs: [], reasons: ['explicit native payload preparation; no application assertions'] } : opts.observe ? { kind: 'observe', groups: ['observation'], specs: ['tests/observation'], reasons: ['explicit read-only opt-in'] } : selectFromGit({ root, base: opts.base, full: opts.full, cohortUnchanged: !opts.full && cohortUnchanged(opts.base, cohort), env });
  if (opts.grep && selection.kind !== 'none') {
    selection = { ...selection, kind: 'focused', testFilter: opts.grep, reasons: [...selection.reasons, 'explicit test-name filter; not full acceptance'] };
  }
  console.log(`E2E selection: ${JSON.stringify(selection)}`);
  if (opts.select) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `kind=${selection.kind}\nrequires_application=${requiresApplication(selection.specs)}\n`);
    return;
  }
  if (selection.kind === 'none') return;
  let playwrightArgs = ['test', ...selection.specs, ...(opts.grep ? ['--grep', opts.grep] : [])];
  if (opts.list) {
    // Direct Node CLI discovery never invokes a package manager or prepares hosts.
    env.OMNIVIEW_E2E_MODE = opts.observe ? 'observe' : 'owned';
    execute(process.execPath, [playwrightCLI(), ...playwrightArgs, '--list'], { cwd: join(root, 'e2e') });
    return;
  }
  if (opts.observe) {
    if (process.env.OMNIVIEW_E2E_TOOL_CACHE_ROOT !== undefined) {
      toolCache = readToolCache(process.env.OMNIVIEW_E2E_TOOL_CACHE_ROOT, { protectedRoots: cacheProtectedRoots(sourceLocations()) });
      env = toolEnvironment(process.env, { toolCacheRoot: toolCache.root });
    }
    env.OMNIVIEW_E2E_MODE = 'observe';
    for (const key of ['OMNIVIEW_E2E_CLI', 'OMNIVIEW_E2E_ROOT', 'OMNIVIEW_E2E_WORKSPACE', 'OMNIVIEW_E2E_WORKSPACE_ID', 'OMNIVIEW_E2E_GENERATION']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    execute(process.execPath, [playwrightCLI(), ...playwrightArgs, '--global-timeout', opts.ui ? '0' : '600000', ...(opts.ui ? ['--ui'] : [])], { cwd: join(root, 'e2e'), timeout: 0 });
    return;
  }
  started = preparationStarted(processStarted, process.env.OMNIVIEW_E2E_PREPARATION_STARTED_AT);
  if (started < processStarted) phases.push({ name: 'workflow-preparation', elapsedMs: processStarted - started });
  // A single invocation owns ALL preparation and browser work. No retry loop,
  // setup job, prebuilt host, force-peer override, or fabricated link evidence.
  assertStandaloneBootstrap(root);
  const sources = {};
  const refs = {};
  sourceRefs = refs;
  privateRoot = realpathSync(mkdtempSync(join(tmpdir(), 'omniview-e2e-')));
  const home = join(privateRoot, 'home');
  mkdirSync(home, { mode: 0o700 });
  if (process.env.OMNIVIEW_E2E_TOOL_CACHE_ROOT !== undefined) {
    toolCache = phase('tool-cache-validation', () => initializeToolCache(process.env.OMNIVIEW_E2E_TOOL_CACHE_ROOT, { protectedRoots: cacheProtectedRoots(sourceLocations(), privateRoot) }));
  }
  env = { ...toolEnvironment(process.env, { toolCacheRoot: toolCache?.root }), HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), GOPATH: join(home, 'go'), GOCACHE: toolCache?.bootstrapGoCache ?? join(home, '.cache/go-build'), PLAYWRIGHT_BROWSERS_PATH: toolCache?.playwrightBrowsers ?? join(home, '.cache/ms-playwright'), SDK_SOURCE: sources['plugin-sdk'], PATH: `${join(home, 'go/bin')}${delimiter}${process.env.PATH}`, OMNIVIEW_E2E_MODE: 'owned' };
  env.OMNIVIEW_E2E_OWNERSHIP_DIR = join(privateRoot, 'ownership');
  mkdirSync(env.OMNIVIEW_E2E_OWNERSHIP_DIR, { mode: 0o700 });
  const pnpm = env.OMNIVIEW_E2E_PNPM_EXECUTABLE ?? 'pnpm';
  if (env.OMNIVIEW_E2E_PNPM_EXECUTABLE && !isAbsolute(pnpm)) throw Error('OMNIVIEW_E2E_PNPM_EXECUTABLE must be an absolute native pnpm executable');
  phase('bootstrap-tools', () => {
    if (process.versions.node !== '24.14.0') throw Error('E2E requires native Node 24.14.0');
    if (execute(pnpm, ['--version'], { capture: true }) !== '12.14.0') throw Error('E2E requires native pnpm 12.14.0');
  });
  phase('dependency-install', () => {
    try { execute(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies', ...(toolCache ? ['--store-dir', toolCache.pnpmStore] : [])]); } catch (error) {
      if (toolCache) throw Error(`${error.message}; changing the standalone pnpm store requires a fresh committed source-tool bootstrap checkout, never forced peers or manual links`);
      throw error;
    }
  });
  if (opts.grep) {
    const report = phase('focused-discovery', () => JSON.parse(execute(process.execPath, [playwrightCLI(), ...playwrightArgs, '--list', '--reporter=json'], { cwd: join(root, 'e2e'), capture: true })));
    const specs = discoveredSpecs(report, join(root, 'e2e'));
    selection = { ...selection, specs, reasons: [...selection.reasons, 'actual Playwright discovery before application preparation'] };
    playwrightArgs = ['test', ...specs, '--grep', opts.grep];
  }
  const needsApplication = opts.cacheOnly || requiresApplication(selection.specs);
  if (needsApplication) {
    if (toolCache) {
      const actual = JSON.parse(execute('go', ['env', '-json', 'GOMODCACHE', 'GOCACHE'], { capture: true }));
      if (actual.GOMODCACHE !== toolCache.goModCache || actual.GOCACHE !== toolCache.bootstrapGoCache) throw Error('Native Go cache paths differ from the validated E2E tool-cache boundary');
    }
    Object.assign(sources, Object.fromEntries(Object.entries(sourceLocations()).map(([id, path]) => [id, realpathSync(path)])));
    Object.assign(refs, Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, repositoryCommit(source, env)])));
    for (const [id, source] of Object.entries(sources)) {
      if (git(source, 'status', '--porcelain', '--untracked-files=all')) throw Error(`Selected ${id} has uncommitted source edits; commit intended source before running owned E2E`);
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(process.env.REVIEWED_SDK_REVISION ?? '') || process.env.REVIEWED_SDK_REVISION !== refs['plugin-sdk']) throw Error('Set REVIEWED_SDK_REVISION to the independently reviewed full selected SDK commit');
    env.SDK_SOURCE = sources['plugin-sdk'];
  }
  if (process.platform === 'linux') {
    linuxDependencies = phase('linux-dependency-install', () => prepareLinuxDependencies({ execute, playwrightCLI: playwrightCLI(), archiveDirectory: process.env.OMNIVIEW_E2E_APT_ARCHIVES_DIRECTORY, native: needsApplication }));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'linux_dependencies_prepared=true\n');
  }
  phase('browser-install', () => execute(process.execPath, [playwrightCLI(), 'install', 'chromium'], { cwd: join(root, 'e2e') }));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'browser_prepared=true\n');
  if (needsApplication) {
  phase('pinned-native-wails-tool', () => {
    env.OMNIVIEW_WAILS_TOOL_CAPABILITY = preparePinnedWailsTool({
      root: sources.omniview, directory: join(privateRoot, 'wails-tool'), bootstrapGoCache: env.GOCACHE, env,
      execute: (command, args, { env: childEnv, cwd }) => execute(command, args, { capture: true, extraEnv: childEnv, cwd }),
    });
  });
  phase('safe-probe-source', () => {
    const probe = JSON.parse(execute(process.execPath, ['e2e/scripts/prepare-workspace-probe.mjs', '--destination', join(privateRoot, 'workspace-probe')], { capture: true }));
    if (probe.pluginID !== 'workspace-probe' || probe.source !== join(privateRoot, 'workspace-probe') || probe.ref !== git(probe.source, 'rev-parse', 'HEAD')) throw Error('Invalid real probe source');
    sources['workspace-probe'] = probe.source;
    refs['workspace-probe'] = probe.ref;
  });
  env.OMNIVIEW_E2E_APPLICATION = prepareApplication({ root, privateRoot, sources, refs, env, execute, phase, recordBuildExecution: report => { buildExecution = report; } });
  for (const [id, source] of Object.entries(sources)) {
    if (git(source, 'rev-parse', 'HEAD') !== refs[id] || git(source, 'diff', '--name-only', 'HEAD', '--')) throw Error(`Selected ${id} source changed during preparation; refusing mixed committed sources`);
  }
  if (!opts.cacheOnly) {
    launchBroker = await startApplicationBroker({ application: env.OMNIVIEW_E2E_APPLICATION, ownershipDir: env.OMNIVIEW_E2E_OWNERSHIP_DIR, env, phases });
    env.OMNIVIEW_E2E_LAUNCH_SOCKET = launchBroker.socketPath;
  }
  }
  if (!opts.cacheOnly) await runApplication([...playwrightArgs, ...(opts.ui ? ['--ui'] : [])]);
  if (needsApplication) {
    phase('original-read-only-source-proof-after-run', () => {
      for (const [id, source] of Object.entries(sources)) {
        if (git(source, 'rev-parse', 'HEAD') !== refs[id] || git(source, 'status', '--porcelain', '--untracked-files=all')) throw Error(`Selected original ${id} changed; retaining the private cohort and ownership evidence`);
      }
    });
    const application = JSON.parse(readFileSync(env.OMNIVIEW_E2E_APPLICATION, 'utf8'));
    phase('canonical-build-cohort-retirement', () => retireApplicationCohort(application.cohort, execute));
  }
  phase('preparation-teardown', () => {
    if (needsApplication) retirePreparationHome(privateRoot, env, { toolCache, deadline: interactive ? Date.now() + 60_000 : started + 600_000 });
    else rmSync(privateRoot, { recursive: true });
    privateRoot = undefined;
  });
}
let succeeded = false;
try { await main(); succeeded = true; } catch (error) {
  console.error(`E2E: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Private sources, probe evidence and failure state stay outside upload paths.
  // Fixture teardown owns workspace down/removal; never recursively delete its
  // private arena after failure or retry the complete preparation implicitly.
  const elapsedMs = Date.now() - started;
  const budgetExceeded = ['application', 'cache-only'].includes(operation) && !interactive && elapsedMs > 600_000;
  if (budgetExceeded) {
    succeeded = false;
    process.exitCode = 1;
    console.error('E2E inclusive600s budget exceeded; owned cleanup was allowed to finish, not force-killed');
  }
  if (privateRoot) console.error(`E2E private preparation retained: ${privateRoot}`);
  const report = { succeeded, operation, interactive, elapsedMs: Date.now() - started, budgetMs: interactive ? null : 600_000, budgetExceeded, deadlineBudget, launchDrain, buildExecution, linuxDependencies, selection, phases, sourceRefs, nativeToolCache: toolCache ? 'explicit' : env.HOME ? 'private' : 'not-used', declaredFrontendModes: selection?.kind !== 'focused' && selection?.groups.includes('workspaces') ? ['embedded', 'live-smoke'] : [], retries: 0 };
  report.applicationAcceptance = operation === 'application' && succeeded && !interactive && selection?.kind === 'full';
  if (operation !== 'report' && operation !== 'cache-initialization') {
    mkdirSync(join(root, 'e2e/playwright-report'), { recursive: true });
    const filename = operation === 'selection' ? 'selection.json' : operation === 'discovery' ? 'discovery.json' : 'invocation.json';
    writeFileSync(join(root, 'e2e/playwright-report', filename), `${JSON.stringify(report, null, 2)}\n`);
  }
}
