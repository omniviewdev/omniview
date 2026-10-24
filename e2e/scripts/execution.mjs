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
  const keys = ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'CI', 'PNPM_HOME', 'PLAYWRIGHT_BROWSERS_PATH', 'OMNIVIEW_E2E_PNPM_EXECUTABLE'];
  const env = Object.fromEntries(keys.filter(key => typeof input[key] === 'string').map(key => [key, input[key]]));
  if (toolCacheRoot) {
    const cache = readToolCache(toolCacheRoot);
    env.OMNIVIEW_E2E_TOOL_CACHE_ROOT = cache.root;
    env.GOCACHE = cache.bootstrapGoCache;
    env.GOMODCACHE = cache.goModCache;
    env.pnpm_config_store_dir = cache.pnpmStore;
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
export function applicationBudget(started, now) {
  const deadline = started + 600_000;
  const remainingMs = deadline - now;
  const cleanupReserveMs = 60_000;
  if (remainingMs <= cleanupReserveMs) throw Error('Inclusive E2E budget exhausted during preparation; refusing to start application profiles');
  return { deadline, remainingMs, interruptAfterMs: remainingMs - cleanupReserveMs, cleanupReserveMs };
}
