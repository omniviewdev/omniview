import { lstatSync, realpathSync } from 'node:fs';
import { devNull } from 'node:os';
import { dirname, join } from 'node:path';

import { execFileSync } from 'node:child_process';
import { readToolCache } from './tool-cache.mjs';
import { validatePinnedWailsTool } from '../../scripts/wails-tool.mjs';
// Start from nothing, not a credential-prefix blacklist. Selected source paths,
// private HOME/cache locations and observation identity are added explicitly by
// the runner; ambient provider/autoconnect/module/manager inputs never reach it.
export function toolEnvironment(input, { toolCacheRoot, wailsToolCapability } = {}) {
  const keys = ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'CI', 'PNPM_HOME', 'OMNIVIEW_E2E_PNPM_EXECUTABLE'];
  const env = Object.fromEntries(keys.filter(key => typeof input[key] === 'string').map(key => [key, input[key]]));
  if (toolCacheRoot) {
    const cache = readToolCache(toolCacheRoot);
    env.OMNIVIEW_E2E_TOOL_CACHE_ROOT = cache.root;
    env.GOCACHE = cache.bootstrapGoCache;
    env.GOMODCACHE = cache.goModCache;
    env.pnpm_config_store_dir = cache.pnpmStore;
    env.PLAYWRIGHT_BROWSERS_PATH = cache.playwrightBrowsers;
  }
  if (wailsToolCapability !== undefined) {
    validatePinnedWailsTool(wailsToolCapability, { env });
    env.OMNIVIEW_WAILS_TOOL_CAPABILITY = wailsToolCapability;
  }
  return { ...env, GOWORK: 'off', GOFLAGS: '', GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}
export function assertStandaloneBootstrap(host) {
  let directory = realpathSync(host);
  for (;;) {
    try {
      lstatSync(join(directory, 'workspace.json'));
      throw Error('E2E bootstrap refuses a managed enclosing workspace: create a dedicated clean standalone committed host source-tool bootstrap checkout and pass explicit clean SDK_SOURCE, UI_SOURCE and KUBERNETES_SOURCE; actual application cohorts are still created by the owned workspace CLI. Never install or manually link inside the enclosing managed source');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
export function repositoryCommit(source, env) {
  const canonical = realpathSync(source);
  const git = (...args) => execFileSync('git', ['-C', canonical, ...args], { env, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (realpathSync(git('rev-parse', '--show-toplevel')) !== canonical) throw Error('Selected source must be its own Git repository root, not an empty submodule or nested directory');
  const ref = git('rev-parse', 'HEAD');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref)) throw Error('Selected source has no immutable commit');
  return ref;
}
export function preparationStarted(now, value) {
  if (value === undefined) return now;
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > now) throw Error('Invalid workflow preparation start; refusing to reset or extend the inclusive E2E deadline');
  return Number(value);
}
export function commandTimeout(started, now, timeout, interactive = false) {
  if (timeout === 0) return undefined;
  if (interactive) return timeout;
  const remaining = started + 600_000 - now;
  if (remaining <= 0) throw Error('Inclusive E2E budget exhausted');
  return Math.min(timeout, remaining);
}
export function applicationBudget(started, now, { interactive = false } = {}) {
  if (interactive) return null;
  const deadline = started + 600_000;
  const remainingMs = deadline - now;
  const cleanupReserveMs = 60_000;
  if (remainingMs <= cleanupReserveMs) throw Error('Inclusive E2E budget exhausted during preparation; refusing to start application profiles');
  return { deadline, remainingMs, interruptAfterMs: remainingMs - cleanupReserveMs, cleanupReserveMs };
}

export function runnerOptions(args, base = process.env.OMNIVIEW_E2E_BASE) {
  const result = { full: true, base };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--full') result.full = true;
    else if (arg === '--changed') result.full = false;
    else if (arg === '--base' && args[i + 1]) result.base = args[++i];
    else if (arg === '--grep' && args[i + 1]) result.grep = args[++i];
    else if (arg === '--list') result.list = true;
    else if (arg === '--select') result.select = true;
    else if (arg === '--ui') result.ui = true;
    else if (arg === '--observe') result.observe = true;
    else if (arg === '--report') result.report = true;
    else if (arg === '--init-tool-cache') result.initToolCache = true;
    else if (arg === '--cache-only') result.cacheOnly = true;
    else throw Error(`Unsupported argument: ${arg}. Use --full, --changed --base REF, --grep PATTERN, --select, --list, --ui, --observe, --report, --init-tool-cache, or --cache-only.`);
  }
  if (result.cacheOnly && (args.length !== 1 || args[0] !== '--cache-only')) throw Error('--cache-only must be used alone; it prepares native payloads, never application acceptance');
  if (args.includes('--full')) result.full = true;
  if (result.observe && !result.full) throw Error('Observation cannot use changed-file selection');
  return result;
}
