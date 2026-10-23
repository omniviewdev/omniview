import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDevBundle, renderDevPlist, validateDevBundleDirectory } from './create-dev-bundle.mjs';

const template = readFileSync(new URL('./Info.dev.plist', import.meta.url), 'utf8');
const manifest = {
  workspaceID: 'f14566c4-5130-4e3f-aa09-3e49c63b29a6',
  displayName: 'Resource <graph> & "tables"',
  profile: { kind: 'development' },
};

test('workspace identity, display title and executable replace template tokens safely', () => {
  const plist = renderDevPlist(template, manifest, 'Omniview');
  assert.match(plist, /dev\.omniview\.workspace\.f14566c4-5130-4e3f-aa09-3e49c63b29a6/);
  assert.match(plist, /Omniview — Resource &lt;graph&gt; &amp; &quot;tables&quot;/);
  assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>Omniview<\/string>/);
  assert.doesNotMatch(plist, /__OMNIVIEW_|dev\.omniview\.app<\/string>/);
  const other = renderDevPlist(template, { ...manifest, workspaceID: '4beee3e2-2450-421c-ad44-485a704c3a65' }, 'Omniview');
  assert.notEqual(other, plist);
});

test('production, noncanonical UUIDs and invalid display names are refused', () => {
  for (const invalid of [
    { ...manifest, profile: { kind: 'production' } },
    { ...manifest, workspaceID: '../production' },
    { ...manifest, workspaceID: '00000000-0000-0000-0000-000000000000' },
    { ...manifest, displayName: 'line\nbreak' },
  ]) {
    assert.throws(() => renderDevPlist(template, invalid, 'Omniview'));
  }
});

test('the real bundle generator rejects XML-invalid names before changing existing or creating partial output', () => {
  const bin = mkdtempSync(path.join(tmpdir(), 'omniview-dev-bundle-'));
  try {
    const contents = path.join(bin, 'Omniview.dev.app', 'Contents');
    const macOS = path.join(contents, 'MacOS');
    mkdirSync(macOS, { recursive: true });
    writeFileSync(path.join(bin, 'Omniview'), 'new source executable');
    writeFileSync(path.join(contents, 'Info.plist'), 'existing plist');
    writeFileSync(path.join(macOS, 'Omniview'), 'existing executable');
    const before = readdirSync(bin, { recursive: true }).sort();
    for (const codePoint of ['\u0001', '\u000b', '\u001f', '\ud800', '\udfff', '\ufffe', '\uffff']) {
      const invalid = { ...manifest, displayName: `Workspace${codePoint}` };
      assert.throws(() => createDevBundle(bin, 'Omniview', invalid), /XML 1\.0/);
      assert.throws(() => createDevBundle(bin, 'NewOutput', invalid), /XML 1\.0/);
      assert.deepEqual(readdirSync(bin, { recursive: true }).sort(), before);
      assert.equal(readFileSync(path.join(contents, 'Info.plist'), 'utf8'), 'existing plist');
      assert.equal(readFileSync(path.join(macOS, 'Omniview'), 'utf8'), 'existing executable');
      assert.equal(existsSync(path.join(bin, 'NewOutput.dev.app')), false);
    }
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test('XML-valid supplementary Unicode and tabs remain accepted', () => {
  const plist = renderDevPlist(template, { ...manifest, displayName: 'Workspace\t\u{1f680}' }, 'Omniview');
  assert.match(plist, /Workspace\t\u{1f680}/u);
});

function stagedBundleFixture() {
  const temporary = realpathSync(mkdtempSync(path.join(tmpdir(), 'omniview-native-stage-')));
  const collection = path.join(temporary, 'collection');
  const root = path.join(collection, 'workspaces', 'feature');
  const host = path.join(root, 'omniview');
  const profile = path.join(temporary, 'profile');
  const nonce = '4beee3e2-2450-421c-ad44-485a704c3a65';
  const stageName = `.generated-stage-${nonce}`;
  const stage = path.join(root, '.local', stageName);
  const ledgerPath = path.join(collection, '.omniview-dev', 'generated', `${manifest.workspaceID}.json`);
  for (const directory of [host, profile, stage, path.dirname(ledgerPath)]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const identity = statSync(stage, { bigint: true });
  const generation = 'active-native-generation';
  const resolved = { root, stateRoot: path.join(profile, 'state'), manifest };
  const pending = {
    generation, nonce, stage: stageName, phase: 'prepared',
    stageIdentity: { device: String(identity.dev), fileID: String(identity.ino) },
  };
  const ledger = {
    schemaVersion: 1, workspaceID: manifest.workspaceID, root,
    entries: {}, pending: { 'bin/native': pending },
  };
  const save = () => writeFileSync(ledgerPath, JSON.stringify(ledger), { mode: 0o600 });
  save();
  return { temporary, root, host, profile, stage, ledgerPath, ledger, pending, generation, resolved, save };
}

test('native output accepts only the exact live prepared staging capability', { skip: !process.geteuid }, () => {
  const fixture = stagedBundleFixture();
  try {
    assert.equal(validateDevBundleDirectory(fixture.stage, fixture.resolved, fixture.host, fixture.generation), fixture.stage);
    const arbitrary = path.join(fixture.root, '.local', 'unrecorded-output');
    mkdirSync(arbitrary, { mode: 0o700 });
    assert.throws(() => validateDevBundleDirectory(arbitrary, fixture.resolved, fixture.host, fixture.generation));
    assert.throws(() => validateDevBundleDirectory(fixture.stage, fixture.resolved, fixture.host, ''));
    assert.throws(() => validateDevBundleDirectory(fixture.stage, fixture.resolved, fixture.host, 'old-generation'));
    rmSync(fixture.ledgerPath);
    for (const ordinary of [path.join(fixture.host, 'bin'), path.join(fixture.profile, 'bin')]) {
      mkdirSync(ordinary, { mode: 0o700 });
      assert.equal(validateDevBundleDirectory(ordinary, fixture.resolved, fixture.host, ''), ordinary);
    }
  } finally {
    rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test('staged bundle capability rejects foreign, stale and imprecise identity records', { skip: !process.geteuid }, async (t) => {
  const changes = {
    'foreign workspace': (f) => { f.ledger.workspaceID = '4beee3e2-2450-421c-ad44-485a704c3a65'; },
    'foreign root': (f) => { f.ledger.root = f.host; },
    'unknown schema': (f) => { f.ledger.schemaVersion = 2; },
    'browser capability': (f) => { f.ledger.pending = { 'bin/browser': f.pending }; },
    'published phase': (f) => { f.pending.phase = 'publishing'; },
    'old generation': (f) => { f.pending.generation = 'old'; },
    'noncanonical nonce': (f) => { f.pending.nonce = f.pending.nonce.toUpperCase(); },
    'different stage': (f) => { f.pending.stage = '.generated-stage-other'; },
    'missing identity': (f) => { delete f.pending.stageIdentity; },
    'number identity': (f) => { f.pending.stageIdentity.fileID = Number(f.pending.stageIdentity.fileID); },
    'foreign device': (f) => { f.pending.stageIdentity.device = String(BigInt(f.pending.stageIdentity.device) + 1n); },
    'foreign inode': (f) => { f.pending.stageIdentity.fileID = String(BigInt(f.pending.stageIdentity.fileID) + 1n); },
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, () => {
      const fixture = stagedBundleFixture();
      try {
        change(fixture);
        fixture.save();
        assert.throws(() => validateDevBundleDirectory(fixture.stage, fixture.resolved, fixture.host, fixture.generation));
      } finally {
        rmSync(fixture.temporary, { recursive: true, force: true });
      }
    });
  }
});

test('replaced or redirected stage and public/linked ledger are refused without changing their contents', { skip: !process.geteuid }, async (t) => {
  const changes = {
    'replacement directory': (f) => {
      renameSync(f.stage, `${f.stage}-original`);
      mkdirSync(f.stage, { mode: 0o700 });
    },
    'stage symlink into allowed host': (f) => {
      renameSync(f.stage, `${f.stage}-original`);
      symlinkSync(f.host, f.stage);
    },
    'public stage': (f) => { chmodSync(f.stage, 0o755); },
    'public ledger': (f) => { chmodSync(f.ledgerPath, 0o644); },
    'ledger symlink': (f) => {
      renameSync(f.ledgerPath, `${f.ledgerPath}.original`);
      symlinkSync(`${f.ledgerPath}.original`, f.ledgerPath);
    },
    'redirected metadata directory': (f) => {
      const directory = path.dirname(f.ledgerPath);
      renameSync(directory, `${directory}-original`);
      symlinkSync(`${directory}-original`, directory);
    },
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, () => {
      const fixture = stagedBundleFixture();
      try {
        writeFileSync(path.join(fixture.host, 'preserve'), 'foreign host content');
        change(fixture);
        assert.throws(() => validateDevBundleDirectory(fixture.stage, fixture.resolved, fixture.host, fixture.generation));
        assert.equal(readFileSync(path.join(fixture.host, 'preserve'), 'utf8'), 'foreign host content');
        assert.equal(existsSync(path.join(fixture.stage, 'Omniview.dev.app')), false);
      } finally {
        rmSync(fixture.temporary, { recursive: true, force: true });
      }
    });
  }
});
