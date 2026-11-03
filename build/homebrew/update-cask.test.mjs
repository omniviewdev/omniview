import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
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

// Evaluate the generated Ruby DSL as a consumer, rather than matching stanza formatting.
function eligibleMacOS(cask, versions) {
  const consumer = spawnSync('ruby', ['-rjson', '-e', `
    class CaskConsumer
      attr_reader :minimum
      def cask(_name, &block)
        instance_eval(&block)
      end
      def depends_on(**requirements)
        @minimum = requirements[:macos] if requirements.key?(:macos)
      end
      def method_missing(*)
        nil
      end
    end
    consumer = CaskConsumer.new
    consumer.instance_eval(STDIN.read)
    puts JSON.generate({ kind: consumer.minimum.class.name, value: consumer.minimum.to_s })
  `], { input: cask, encoding: 'utf8' });
  assert.equal(consumer.status, 0, consumer.stderr);
  const requirement = JSON.parse(consumer.stdout);
  assert.equal(requirement.kind, 'Symbol', 'Homebrew requires a named macOS release symbol');
  const named = { big_sur: [11], monterey: [12], ventura: [13], sequoia: [15], tahoe: [26] };
  const minimum = named[requirement.value];
  assert.ok(minimum, `Unknown consumer version: ${requirement.value}`);
  return versions.map((version) => {
    const components = version.split('.').map(Number);
    for (let index = 0; index < Math.max(components.length, minimum.length); index++) {
      const difference = (components[index] ?? 0) - (minimum[index] ?? 0);
      if (difference !== 0) return difference > 0;
    }
    return true;
  });
}

for (const channel of ['omniview', 'omniview-nightly']) {
  for (const requirement of [null, '>= :big_sur', '>= 10.15', '>= 11.7', '>= :monterey', '>= 12']) {
    test(`${channel}: enforce Monterey eligibility from ${requirement ?? 'no minimum'}`, () => {
      const input = requirement === null ? source(channel)
        : source(channel).replace('  app ', `  depends_on macos: "${requirement}"\n  app `);
      const result = updateCask(input, '0.26.0', sha);
      assert.deepEqual(eligibleMacOS(result, ['10.15', '11', '11.7', '12', '12.7', '13', '26']),
        [false, false, false, true, true, true, true]);
      assert.equal(updateCask(result, '0.26.0', sha), result);
    });
  }
  for (const [requirement, eligibility] of [
    ['>= :ventura', [false, false, false, false, true, true, true]],
    ['>= 13.0', [false, false, false, false, true, true, true]],
    ['>= 15', [false, false, false, false, false, true, true]],
    ['>= :tahoe', [false, false, false, false, false, false, true]],
  ]) {
    test(`${channel}: preserve stricter eligibility ${requirement}`, () => {
      const input = source(channel).replace('  app ', `  depends_on macos: "${requirement}"\n  app `);
      const result = updateCask(input, '0.26.0', sha);
      const versions = ['11', '12', '12.2', '12.3', '13', '15', '26'];
      assert.deepEqual(eligibleMacOS(result, versions), eligibility);
      assert.equal(updateCask(result, '0.26.0', sha), result);
    });
  }
  test(`${channel}: refuse ambiguous or unsupported eligibility`, () => {
    for (const stanza of [
      '  depends_on macos: ">= :future_release"',
      '  depends_on macos: :future_release',
      '  depends_on macos: ">= 12.3"',
      '  depends_on macos: ">= 13.0.1"',
      '  depends_on macos: ">= 12", arch: :arm64',
      '  depends_on macos: ["12", "13"]',
      '  depends_on :macos => ">= 12"',
      '  depends_on macos: ">= 12"\n  depends_on macos: ">= 13"',
      '  depends_on macos: ">= 12" if Hardware::CPU.arm?',
      '  depends_on macos:\n    ">= 12"',
    ]) {
      const input = source(channel).replace('  app ', `${stanza}\n  app `);
      assert.throws(() => updateCask(input, '0.26.0', sha), /Unexpected macOS requirement/);
    }
  });
}
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
