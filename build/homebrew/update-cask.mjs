import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const binary = '  binary "#{appdir}/Omniview.app/Contents/MacOS/omniview-dev", target: "omniview-dev"';

// Keep tap-owned metadata and zap rules. Refuse unfamiliar layouts instead of
// publishing a cask that silently omits its CLI or links the wrong executable.
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
  let result = source.replace(/^  version "[^"\r\n]+"$/m, `  version "${version}"`)
    .replace(/^  sha256 "[0-9a-f]{64}"$/m, `  sha256 "${sha256}"`);
  if (binaries.length === 0) result = result.replace(/^  app "Omniview\.app"$/m, `$&\n${binary}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, version, sha256, ...extra] = process.argv.slice(2);
  if (!file || !version || !sha256 || extra.length) throw new Error('Usage: node update-cask.mjs CASK VERSION SHA256');
  writeFileSync(file, updateCask(readFileSync(file, 'utf8'), version, sha256));
}
