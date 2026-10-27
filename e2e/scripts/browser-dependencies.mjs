import { fileURLToPath } from 'node:url';

// Keep the host recipe here; Chromium's libraries/fonts come from the actual
// pinned Playwright dependency simulation, not a second handwritten package list.
const nativePackages = ['libgtk-4-dev', 'libwebkitgtk-6.0-dev', 'libwayland-dev', 'build-essential', 'pkg-config'];
const archiveVerifier = fileURLToPath(new URL('../../scripts/verify-apt-archives.mjs', import.meta.url));

export function missingLinuxPackages(output) {
  if (output === 'All system dependencies are installed.') return [];
  const [heading, ...lines] = output.split('\n');
  const count = /^Missing system dependencies \(([1-9][0-9]*)\):$/.exec(heading);
  const packages = lines.map(line => /^  ([a-z0-9][a-z0-9+.-]*(?::[a-z0-9][a-z0-9-]*)?)$/.exec(line)?.[1]);
  if (!count || Number(count[1]) !== packages.length || packages.some(name => !name) || new Set(packages).size !== packages.length) throw Error('Unrecognized pinned Playwright dependency simulation; refusing an incomplete Linux package recipe');
  return packages;
}

export function prepareLinuxDependencies({ execute, playwrightCLI, archiveDirectory, native = true }) {
  const aptCommand = process.getuid?.() === 0 ? 'apt-get' : 'sudo';
  const aptPrefix = aptCommand === 'sudo' ? ['apt-get'] : [];
  if (archiveDirectory) {
    // The workflow refreshes authenticated indexes before restoring archives.
    // Cache bytes never authorize their own package names, versions or hashes.
    execute(process.execPath, [archiveVerifier, archiveDirectory]);
  } else {
    execute(aptCommand, [...aptPrefix, 'update']);
  }
  const probe = [playwrightCLI, 'install-deps', '--dry-run', 'chromium'];
  // Playwright 1.64.1 uses exit1 for a successful simulation with missing
  // packages. Unknown output/errors still fail closed; post-install requires0.
  const result = execute(process.execPath, probe, { capture: 'result', acceptedExitCodes: [0, 1] });
  if (result.stderr || ![0, 1].includes(result.status)) throw Error(`Pinned Playwright dependency simulation failed or reported an unsupported platform: ${result.stderr}`);
  const missingBrowserPackages = missingLinuxPackages(result.stdout);
  if (result.status !== (missingBrowserPackages.length ? 1 : 0)) throw Error('Pinned Playwright dependency simulation returned an inconsistent status');
  const packages = [...new Set([...(native ? nativePackages : []), ...missingBrowserPackages])];
  if (packages.length) {
    execute(aptCommand, [...aptPrefix, ...(archiveDirectory ? ['-o', `Dir::Cache::archives=${archiveDirectory}`] : []), 'install', '-y', '--no-install-recommends', ...packages]);
    if (missingLinuxPackages(execute(process.execPath, probe, { capture: true })).length) throw Error('Linux browser dependencies remain missing after provisioning');
  }
  return { missingBrowserPackages, native, authenticatedArchives: archiveDirectory ? 'validated' : 'not-used' };
}
