import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const binary = '  binary "#{appdir}/Omniview.app/Contents/MacOS/omniview-dev", target: "omniview-dev"';
const macOSBaseline = '  depends_on macos: :ventura';
const macOSVersions = {
  tiger: '10.4', leopard: '10.5', snow_leopard: '10.6', lion: '10.7',
  mountain_lion: '10.8', mavericks: '10.9', yosemite: '10.10', el_capitan: '10.11',
  sierra: '10.12', high_sierra: '10.13', mojave: '10.14', catalina: '10.15',
  big_sur: '11', monterey: '12', ventura: '13', sonoma: '14', sequoia: '15', tahoe: '26', golden_gate: '27',
};

// Keep tap-owned metadata and zap rules. Refuse unfamiliar layouts instead of
// publishing a cask that omits its CLI, links the wrong executable, or weakens eligibility.
export function updateCask(source, version, sha256) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid cask version');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid SHA-256');
  for (const [name, pattern] of [
    ['cask', /^cask "omniview(?:-nightly)?" do$/gm],
    ['version', /^  version "[^"\r\n]+"$/gm],
    ['sha256', /^  sha256 "[0-9a-f]{64}"$/gm],
    ['app', /^  app "Omniview\.app"$/gm],
  ]) {
    if ([...source.matchAll(pattern)].length !== 1) throw new Error(`Expected exactly one ${name} stanza`);
  }
  const channel = source.match(/^cask "(omniview(?:-nightly)?)" do$/m)[1];
  const releaseTag = channel === 'omniview' ? 'v#{version}' : 'nightly';
  const url = `  url "https://github.com/omniviewdev/omniview/releases/download/${releaseTag}/Omniview_#{version}_darwin_universal.dmg"`;
  const urls = source.split('\n').filter((line) => /^  url\b/.test(line));
  if (urls.length !== 1 || urls[0] !== url) throw new Error('Unexpected universal release archive URL');
  const binaries = source.split('\n').filter((line) => /^\s*binary\b/.test(line));
  if (binaries.length > 1 || (binaries.length === 1 && binaries[0] !== binary)) {
    throw new Error('Unexpected binary stanza; review CLI linking before publication');
  }
  // Production Info.plist and Go builds require macOS 13. Preserve stricter tap policy.
  const macOSLines = source.split('\n').filter((line) => /\bmacos\b/.test(line));
  if (macOSLines.length > 1) throw new Error('Unexpected macOS requirement; review eligibility before publication');
  let macOSRequirement = macOSBaseline;
  if (macOSLines.length === 1) {
    const requirement = macOSLines[0].match(/^  depends_on macos: (?::([a-z_]+)|">= (?::([a-z_]+)|(\d+(?:\.\d+){0,2}))")$/);
    const name = requirement?.[1] ?? requirement?.[2];
    const minimum = name ? macOSVersions[name] : requirement?.[3];
    if (!minimum) {
      throw new Error('Unexpected macOS requirement; review eligibility before publication');
    }
    const components = minimum.split('.').map(Number);
    if (components[0] >= 13) {
      // Refuse unrepresentable minima rather than weaken eligibility or emit deprecated DSL.
      const release = Object.entries(macOSVersions).find(([, value]) => value === String(components[0]));
      if (!release || !components.slice(1).every((value) => value === 0)) {
        throw new Error('Unexpected macOS requirement; review eligibility before publication');
      }
      macOSRequirement = `  depends_on macos: :${release[0]}`;
    }
  }
  let result = source.replace(/^  version "[^"\r\n]+"$/m, `  version "${version}"`)
    .replace(/^  sha256 "[0-9a-f]{64}"$/m, `  sha256 "${sha256}"`);
  if (binaries.length === 0) result = result.replace(/^  app "Omniview\.app"$/m, `$&\n${binary}`);
  if (macOSLines.length === 0) result = result.replace(/^  app "Omniview\.app"$/m, `${macOSBaseline}\n$&`);
  else result = result.replace(macOSLines[0], macOSRequirement);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, version, sha256, ...extra] = process.argv.slice(2);
  if (!file || !version || !sha256 || extra.length) throw new Error('Usage: node update-cask.mjs CASK VERSION SHA256');
  writeFileSync(file, updateCask(readFileSync(file, 'utf8'), version, sha256));
}
