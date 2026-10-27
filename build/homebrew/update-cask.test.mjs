import assert from 'node:assert/strict';
import test from 'node:test';
import { updateCask } from './update-cask.mjs';

const sha = 'a'.repeat(64);
const cli = '  binary "#{appdir}/Omniview.app/Contents/MacOS/omniview-dev", target: "omniview-dev"';
const source = (channel) => `cask "${channel}" do
  version "0.7.0"
  sha256 "${'b'.repeat(64)}"
  url "https://github.com/omniviewdev/omniview/releases/download/${channel === 'omniview' ? 'v#{version}' : 'nightly'}/Omniview_#{version}_darwin_universal.dmg"
  app "Omniview.app"
  zap trash: ["~/.omniview"]
end
`;

for (const channel of ['omniview', 'omniview-nightly']) {
  test(`${channel}: upgrade old app-only casks and retain metadata`, () => {
    const result = updateCask(source(channel), '0.8.0-nightly.20261027', sha);
    assert.match(result, /version "0.8.0-nightly.20261027"/);
    assert.ok(result.includes(`  sha256 "${sha}"`));
    assert.ok(result.includes(`  app "Omniview.app"\n${cli}`));
    assert.ok(result.includes(source(channel).split('\n').find((line) => line.startsWith('  url '))));
    assert.ok(result.includes('  zap trash: ["~/.omniview"]'));
    assert.equal(updateCask(result, '0.8.0-nightly.20261027', sha), result);
    const upgraded = updateCask(result, '0.8.1', 'c'.repeat(64));
    assert.equal(upgraded.split(cli).length, 2);
    assert.match(upgraded, /version "0.8.1"/);
  });
}

test('refuse malformed publication inputs without changing files', () => {
  for (const version of ['latest', '0.8.0"\n  binary "evil', '../0.8.0']) {
    assert.throws(() => updateCask(source('omniview'), version, sha), /Invalid cask version/);
  }
  assert.throws(() => updateCask(source('omniview'), '0.8.0', 'broken'), /Invalid SHA-256/);
  for (const stanza of ['version', 'sha256', 'app']) {
    const line = source('omniview').split('\n').find((value) => value.startsWith(`  ${stanza} `));
    assert.throws(() => updateCask(source('omniview').replace(line, ''), '0.8.0', sha), /exactly one/);
    assert.throws(() => updateCask(source('omniview').replace(line, `${line}\n${line}`), '0.8.0', sha), /exactly one/);
  }
  assert.throws(() => updateCask(source('omniview').replace('Omniview.app', 'Other.app'), '0.8.0', sha), /app stanza/);
  assert.throws(() => updateCask(source('omniview').replace('  app ', '  binary "wrong"\n  app '), '0.8.0', sha), /Unexpected binary/);
  assert.throws(() => updateCask(source('omniview').replace('  app ', `${cli}\n${cli}\n  app `), '0.8.0', sha), /Unexpected binary/);
  assert.throws(() => updateCask(source('omniview').replace('darwin_universal.dmg', 'darwin_arm64.dmg'), '0.8.0', sha), /release archive URL/);
});
