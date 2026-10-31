import { execFileSync } from 'node:child_process';
import { toolEnvironment } from './execution.mjs';

// Select complete behavioral groups; never remove assertions within a scenario.
export const groups = {
  layout: ['tests/layout'],
  settings: ['tests/settings'],
  plugins: ['tests/plugins'],
  panels: ['tests/panels'],
  workspaces: ['tests/workspaces'],
  tooling: ['tests/integration'],
  contracts: ['tests/fixtures'],
};
const prose = new Set([
  'README.md',
  'docs/development-cli.md',
  'docs/plugin-development.md',
  'docs/roadmap/2026-10-17-product-roadmap.md',
  'docs/roadmap/2026-10-17-resource-intelligence-baseline.md',
  'docs/roadmap/2026-10-17-resource-intelligence-contract-readiness.md',
  'docs/roadmap/2026-10-17-resource-intelligence-work-packages.md',
  'docs/roadmap/2026-10-23-resource-intelligence-remote-index.md',
  'docs/roadmap/2026-10-25-global-command-search-acceptance.md',
]);
const specGroups = new Map([
  ['e2e/tests/layout/app-shell.spec.ts', ['layout', 'workspaces']],
  ['e2e/tests/layout/navigation.spec.ts', ['layout', 'workspaces']],
  ['e2e/tests/layout/new-tab-launcher.spec.ts', ['layout', 'plugins', 'workspaces']],
  ['e2e/tests/layout/theme.spec.ts', ['layout', 'settings', 'workspaces']],
  ['e2e/tests/settings/settings.spec.ts', ['layout', 'settings', 'workspaces']],
  ['e2e/tests/plugins/plugins.spec.ts', ['layout', 'plugins', 'workspaces']],
  ['e2e/tests/panels/bottom-drawer.spec.ts', ['layout', 'panels', 'workspaces']],
  ['e2e/tests/workspaces/workspaces.spec.ts', ['workspaces']],
  ['e2e/tests/workspaces/consumers.spec.ts', ['workspaces']],
  ['e2e/tests/integration/published-consumers.spec.ts', ['tooling']],
]);
function full(reason) {
  return { kind: 'full', groups: Object.keys(groups), specs: Object.values(groups).flat(), reasons: [reason] };
}
export function cohortMatches({ current, baseline, actual } = {}) {
  return Boolean(current && baseline && actual && ['plugin-sdk', 'ui', 'kubernetes'].every(id =>
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(current[id]) &&
    baseline[id] === current[id] && actual[id] === current[id]));
}
export function parseNameStatus(data) {
  if (typeof data !== 'string' || !data.endsWith('\0')) throw Error('Incomplete Git change data');
  const fields = data.slice(0, -1).split('\0');
  const changes = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (!/^(?:[AMDTU]|[RC]\d{1,3})$/.test(status)) throw Error('Unknown Git change status');
    const count = /^[RC]/.test(status) ? 2 : 1;
    const paths = fields.slice(i, i + count);
    if (paths.length !== count || paths.some(path => !path)) throw Error('Truncated Git paths');
    i += count;
    changes.push({ status, paths });
  }
  return changes;
}
export function selectChanges({ full: forceFull = false, changes, complete = false, cohortUnchanged = false } = {}) {
  if (forceFull) return full('explicit full override');
  if (!complete || !cohortUnchanged || !Array.isArray(changes) || changes.length === 0) return full('missing change data or unproven source cohort');
  const selected = new Set();
  for (const entry of changes) {
    if (!entry || !/^(?:[AMDTU]|[RC]\d{1,3})$/.test(entry.status) || !Array.isArray(entry.paths) || entry.paths.length !== (/^[RC]/.test(entry.status) ? 2 : 1)) return full('malformed change data');
    for (const path of entry.paths) {
      if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) return full('invalid changed path');
      if (prose.has(path)) continue;
      let affected = specGroups.get(path);
      if (!affected && path.startsWith('e2e/fixtures/published-consumers/')) affected = ['tooling'];
      if (!affected && (path.startsWith('packages/omniviewdev-vite-plugin/') || path.startsWith('ui/features/plugins/api/'))) affected = ['layout', 'plugins', 'workspaces', 'tooling'];
      if (!affected && path.startsWith('ui/features/plugins/')) affected = ['layout', 'plugins', 'workspaces'];
      if (!affected) return full('core, cohort, or unclassified change');
      for (const group of affected) selected.add(group);
    }
  }
  const names = Object.keys(groups).filter(group => selected.has(group));
  return { kind: names.length ? 'selected' : 'none', groups: names, specs: names.flatMap(group => groups[group]), reasons: [names.length ? 'union of affected groups including dependencies' : 'explicit prose-only allowlist'] };
}
export function selectFromGit({ root, base, cohortUnchanged = false, full: forceFull = false, env = toolEnvironment(process.env) }) {
  if (forceFull || !base) return full(forceFull ? 'explicit full override' : 'no base supplied');
  try {
    const git = args => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const mergeBase = git(['merge-base', base, 'HEAD']).trim();
    if (!/^[a-f0-9]{40,64}$/.test(mergeBase)) return full('unavailable merge base');
    const data = git(['diff', '--name-status', '-z', '--find-renames', mergeBase, 'HEAD', '--']);
    // Include local staged/unstaged/deleted/untracked paths rather than silently
    // selecting against only the committed PR when this command is used locally.
    const local = git(['status', '--porcelain', '-z', '--untracked-files=all']);
    if (local) return full('uncommitted source changes');
    return selectChanges({ changes: parseNameStatus(data), complete: true, cohortUnchanged });
  } catch { return full('change collection failed or exceeded bounded data size'); }
}
