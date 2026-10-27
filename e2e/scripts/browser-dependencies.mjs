// Local Linux installation recipe; CI bakes these headers into its image.
// Chromium's libraries/fonts come from the pinned Playwright simulation.
const nativePackages = ['libgtk-4-dev', 'libwebkitgtk-6.0-dev', 'libwayland-dev', 'build-essential', 'pkg-config'];

export function missingLinuxPackages(output) {
  if (output === 'All system dependencies are installed.') return [];
  const [heading, ...lines] = output.split('\n');
  const count = /^Missing system dependencies \(([1-9][0-9]*)\):$/.exec(heading);
  const packages = lines.map(line => /^  ([a-z0-9][a-z0-9+.-]*(?::[a-z0-9][a-z0-9-]*)?)$/.exec(line)?.[1]);
  if (!count || Number(count[1]) !== packages.length || packages.some(name => !name) || new Set(packages).size !== packages.length) throw Error('Unrecognized pinned Playwright dependency simulation; refusing an incomplete Linux package recipe');
  return packages;
}

export function prepareLinuxDependencies({ execute, playwrightCLI, preinstalled = false, native = true }) {
  if (preinstalled && native) {
    try {
      execute('pkg-config', ['--exists', 'gtk4', 'webkitgtk-6.0', 'wayland-client']);
    } catch (error) {
      throw Error('Preinstalled Linux image is missing native GTK4, WebKit6 or Wayland development dependencies; rebuild the CI image', { cause: error });
    }
  }
  const probe = [playwrightCLI, 'install-deps', '--dry-run', 'chromium'];
  // Playwright 1.64.1 uses exit1 for a successful simulation with missing
  // packages. Unknown output/errors still fail closed; post-install requires0.
  const inspect = () => {
    const result = execute(process.execPath, probe, { capture: 'result', acceptedExitCodes: [0, 1] });
    if (result.stderr || ![0, 1].includes(result.status)) throw Error(`Pinned Playwright dependency simulation failed or reported an unsupported platform: ${result.stderr}`);
    const missing = missingLinuxPackages(result.stdout);
    if (result.status !== (missing.length ? 1 : 0)) throw Error('Pinned Playwright dependency simulation returned an inconsistent status');
    return missing;
  };
  const missingBrowserPackages = inspect();
  if (preinstalled) {
    if (missingBrowserPackages.length) throw Error(`Preinstalled Linux image is missing Playwright system dependencies: ${missingBrowserPackages.join(', ')}; rebuild the CI image`);
    return { missingBrowserPackages, native, preinstalled };
  }
  const packages = [...new Set([...(native ? nativePackages : []), ...missingBrowserPackages])];
  if (packages.length) {
    const aptCommand = process.getuid?.() === 0 ? 'apt-get' : 'sudo';
    const aptPrefix = aptCommand === 'sudo' ? ['apt-get'] : [];
    execute(aptCommand, [...aptPrefix, 'update']);
    execute(aptCommand, [...aptPrefix, 'install', '-y', '--no-install-recommends', ...packages]);
    if (inspect().length) throw Error('Linux browser dependencies remain missing after provisioning');
  }
  return { missingBrowserPackages, native, preinstalled };
}
