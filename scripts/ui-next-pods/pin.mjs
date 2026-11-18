// The plugin pin of the Pods cluster check (.github/workflows/ui-next-pods.yml): the check builds the Kubernetes plugin from its `feature/ui-next` branch at a pinned
// commit and runs it in THIS host. The plugin was built against a host: its `ui/vendor/` holds the packed kit and runtime, the list of names the host shares with a
// plugin's bundle (`shared-specifiers.json`) and the host commit all of it was packed from (`HOST_COMMIT`). Before anything is built, the pin is checked against the
// host under test, so a mismatch is one clear line and not a bundle the loader refuses, or a runtime that lacks a hook, twenty minutes later:
//
//   1. the plugin's list of shared names is the host's `SHARED_SPECIFIERS_V1` (ui-next/plugins/loader/specifiers.ts), name for name, in any order;
//   2. `HOST_COMMIT` is the host under test or one of its ancestors: the plugin was not packed from a host that this one does not contain.
//
//   node scripts/ui-next-pods/pin.mjs <plugin checkout> [host ref, default HEAD]      exit 0 when the pin fits, 1 with one line per problem
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HEX40 = /^[0-9a-f]{40}$/;
const here = path.dirname(fileURLToPath(import.meta.url));
const hostRoot = path.resolve(here, '../..');

/** The names in `plugin` and not in `host`, and the names in `host` and not in `plugin`. */
export function compareNames(plugin, host) {
  return { onlyPlugin: plugin.filter((name) => !host.includes(name)).sort(), onlyHost: host.filter((name) => !plugin.includes(name)).sort() };
}

/** Whether `commit` is `ref` or one of its ancestors in the repository at `repo`: 'yes', 'no', or 'unknown' when git cannot tell (a commit it does not have, a shallow clone). */
export function ancestry(repo, commit, ref) {
  const result = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', commit, ref], { encoding: 'utf8' });
  if (result.status === 0) return 'yes';
  return result.status === 1 ? 'no' : 'unknown';
}

/** The problems of a plugin checkout as a pin for the host at `hostRepo`, as readable lines; empty when it fits. */
export function checkPin({ pluginDir, hostNames, hostRepo = hostRoot, hostRef = 'HEAD' }) {
  const problems = [];
  const vendor = (name) => path.join(pluginDir, 'ui/vendor', name);

  let vendored;
  try {
    vendored = JSON.parse(readFileSync(vendor('shared-specifiers.json'), 'utf8'));
  } catch (error) {
    problems.push(`cannot read ${vendor('shared-specifiers.json')}: ${error.message}`);
  }
  if (vendored !== undefined) {
    const { onlyPlugin, onlyHost } = compareNames(vendored, hostNames);
    if (onlyPlugin.length > 0 || onlyHost.length > 0) {
      problems.push(
        `the plugin's list of shared names is not the host's (ui-next/plugins/loader/specifiers.ts)` +
          `${onlyPlugin.length > 0 ? `; the plugin lists ${onlyPlugin.map((name) => `"${name}"`).join(', ')}, which the host does not share` : ''}` +
          `${onlyHost.length > 0 ? `; the host shares ${onlyHost.map((name) => `"${name}"`).join(', ')}, which the plugin does not list` : ''}` +
          `: vendor the plugin from this host again (hack/vendor-host.sh in the plugin) and bump the pin`,
      );
    }
  }

  let commit;
  try {
    commit = readFileSync(vendor('HOST_COMMIT'), 'utf8').trim();
  } catch (error) {
    problems.push(`cannot read ${vendor('HOST_COMMIT')}: ${error.message}`);
  }
  if (commit !== undefined) {
    if (!HEX40.test(commit)) {
      problems.push(`ui/vendor/HOST_COMMIT is not a full commit id: ${JSON.stringify(commit)}`);
    } else {
      const found = ancestry(hostRepo, commit, hostRef);
      if (found === 'no') {
        problems.push(`ui/vendor/HOST_COMMIT ${commit} is not ${hostRef} or one of its ancestors: the plugin was packed from a host this one does not contain; rebase this branch, or pin an older plugin commit`);
      } else if (found === 'unknown') {
        problems.push(`ui/vendor/HOST_COMMIT ${commit} is not known to this checkout of the host (a shallow clone has no history to look in: fetch it whole, \`fetch-depth: 0\`)`);
      }
    }
  }

  return problems;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [pluginDir, hostRef = 'HEAD'] = process.argv.slice(2);
  if (pluginDir === undefined) {
    console.error('usage: node scripts/ui-next-pods/pin.mjs <plugin checkout> [host ref]');
    process.exit(2);
  }
  const { SHARED_SPECIFIERS_V1 } = await import(pathToFileURL(path.join(hostRoot, 'ui-next/plugins/loader/specifiers.ts')).href);
  const problems = checkPin({ pluginDir: path.resolve(pluginDir), hostNames: [...SHARED_SPECIFIERS_V1], hostRef });
  for (const problem of problems) console.error(`pin: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`pin ok: ${path.resolve(pluginDir)} shares the host's ${String(SHARED_SPECIFIERS_V1.length)} names and was packed from a host commit that ${hostRef} contains`);
}
