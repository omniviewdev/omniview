import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  test(`${channel}: refuse ambiguous or unsupported eligibility`, () => {
    for (const stanza of [
      '  depends_on macos: ">= 13.3"',
      '  depends_on macos: ">= 13.3.1"',
      '  depends_on macos: ">= 26.0.1"',
      '  depends_on macos: ">= 28"',
      '  depends_on macos: ">= :future_release"',
      '  depends_on macos: :future_release',
      '  depends_on macos: ">= 13", arch: :arm64',
      '  depends_on macos: ["13", "14"]',
      '  depends_on :macos => ">= 13"',
      '  depends_on macos: ">= 13"\n  depends_on macos: ">= 14"',
      '  depends_on macos: ">= 13" if Hardware::CPU.arm?',
      '  depends_on macos:\n    ">= 13"',
    ]) {
      const input = source(channel).replace('  app ', `${stanza}\n  app `);
      assert.throws(() => updateCask(input, '0.26.0', sha), Error);
    }
  });
}

test('reject invalid release data and ambiguous cask ownership', () => {
  for (const version of ['latest', '0.8.0"\n  binary "evil', '../0.8.0']) {
    assert.throws(() => updateCask(source('omniview'), version, sha), Error);
  }
  assert.throws(() => updateCask(source('omniview'), '0.8.0', 'broken'), Error);
  for (const stanza of ['version', 'sha256', 'app']) {
    const line = source('omniview').split('\n').find((value) => value.startsWith(`  ${stanza} `));
    assert.throws(() => updateCask(source('omniview').replace(line, ''), '0.8.0', sha), Error);
    assert.throws(() => updateCask(source('omniview').replace(line, `${line}\n${line}`), '0.8.0', sha), Error);
  }
  assert.throws(() => updateCask(source('omniview').replace('Omniview.app', 'Other.app'), '0.8.0', sha), Error);
  assert.throws(() => updateCask(source('omniview').replace('  app ', '  binary "wrong"\n  app '), '0.8.0', sha), Error);
  assert.throws(() => updateCask(source('omniview').replace('  app ', `${cli}\n${cli}\n  app `), '0.8.0', sha), Error);
  assert.throws(() => updateCask(source('omniview').replace('darwin_universal.dmg', 'darwin_arm64.dmg'), '0.8.0', sha), Error);
});

test('publication command leaves precise unsupported tap policy untouched', () => {
  const directory = mkdtempSync(join(tmpdir(), 'omniview-cask-policy-'));
  const file = join(directory, 'omniview.rb');
  try {
    for (const minimum of ['13.3', '13.3.1', '26.0.1']) {
      const original = source('omniview').replace('  app ', `  depends_on macos: ">= ${minimum}"\n  app `);
      writeFileSync(file, original);
      const command = spawnSync(process.execPath, [
        fileURLToPath(new URL('./update-cask.mjs', import.meta.url)), file, '0.27.1', sha,
      ], { encoding: 'utf8' });
      assert.notEqual(command.status, 0);
      assert.equal(readFileSync(file, 'utf8'), original);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
