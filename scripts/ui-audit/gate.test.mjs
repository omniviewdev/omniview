import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AuditGate, isRelevant, verdicts } from './gate.mjs';
const exec = promisify(execFile);
const auditor = { kind: 'sub', id: 'audit-child', name: 'omniview-ui-auditor', parentId: 'parent', thinkingLevel: 'high', model: { provider: 'test-provider', id: 'test-model' } };
async function fixture(t, checker = async () => []) {
  const root = await mkdtemp(join(tmpdir(), 'ui-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await exec('git', ['init', root]);
  await mkdir(join(root, 'ui'));
  await writeFile(join(root, 'ui/base.tsx'), 'baseline');
  await exec('git', ['-C', root, 'add', '.']);
  const gate = new AuditGate(root, 'session', 'parent', checker);
  await gate.start();
  return { root, gate };
}
async function reportFor(root, gate) {
  const pending = await gate.inspect(auditor);
  // Real 1x1 PNG fixture; production provenance is an explicit trust limit.
  await writeFile(join(root, 'capture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64'));
  return { snapshot: pending.snapshot, ...Object.fromEntries(verdicts.map(key => [key, 'pass'])), findings: [], libraryRequests: [], unverified: [], evidence: [{ path: 'capture.png', kind: 'screenshot', verdicts }] };
}
test('backend-only changes do not require audit', async t => {
  const { root, gate } = await fixture(t);
  await writeFile(join(root, 'main.go'), 'package main');
  assert.equal(await gate.stop(), undefined);
});
test('initial dirt is baseline, shell and untracked writes are detected', async t => {
  const { root, gate } = await fixture(t);
  assert.equal(await gate.stop(), undefined);
  await exec(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1], "external")', join(root, 'ui/external.tsx')]);
  assert.deepEqual((await gate.pending()).changed, ['ui/external.tsx']);
  assert.equal((await gate.stop()).decision, 'block');
});
test('approval avoids repeat audit and source edits invalidate it', async t => {
  const { root, gate } = await fixture(t);
  await writeFile(join(root, 'ui/base.tsx'), 'edit');
  const report = await reportFor(root, gate);
  assert.equal((await gate.submit(auditor, report)).accepted, true);
  assert.equal(await gate.stop(), undefined);
  assert.equal(await gate.stop(), undefined);
  await writeFile(join(root, 'ui/base.tsx'), 'later edit');
  assert.equal((await gate.stop()).decision, 'block');
  assert.equal((await gate.submit(auditor, report)).accepted, false);
});
test('only direct named child may attest; inspection is mandatory', async t => {
  const { root, gate } = await fixture(t);
  await writeFile(join(root, 'ui/base.tsx'), 'edit');
  const report = await reportFor(root, gate);
  for (const identity of [{ ...auditor, kind: 'main' }, { ...auditor, name: 'other' }, { ...auditor, parentId: 'other' }]) {
    await assert.rejects(gate.submit(identity, report), /Only a direct/);
  }
  assert.equal((await gate.submit({ ...auditor, id: 'uninspected' }, report)).accepted, false);
});
test('missing artifacts, fake screenshots, failure and unverified results block', async t => {
  const { root, gate } = await fixture(t);
  await writeFile(join(root, 'ui/base.tsx'), 'edit');
  const report = await reportFor(root, gate);
  for (const patch of [{ evidence: [] }, { libraryCompliance: 'fail' }, { unverified: ['no browser'] }, { findings: ['bad layout'] }, { libraryRequests: ['add primitive'] }, { evidence: [{ path: 'absent.png', kind: 'screenshot', verdicts }] }]) {
    assert.equal((await gate.submit(auditor, { ...report, ...patch })).accepted, false);
  }
  await writeFile(join(root, 'capture.png'), 'this is not a screenshot');
  assert.equal((await gate.submit(auditor, report)).accepted, false);
  assert.equal((await gate.stop()).decision, 'block');
});
test('preexisting findings do not block unrelated edits; new violations block', async t => {
  let findings = [{ rule: 'native', file: 'ui/base.tsx', line: 1, message: 'native control' }];
  const { root, gate } = await fixture(t, async () => findings);
  await writeFile(join(root, 'ui/other.tsx'), 'valid');
  assert.deepEqual((await gate.pending()).findings, []);
  findings = [...findings, { rule: 'native', file: 'ui/other.tsx', line: 1, message: 'native control' }];
  await writeFile(join(root, 'ui/other.tsx'), 'new violation');
  assert.equal((await gate.pending()).findings.length, 1);
  assert.equal((await gate.submit(auditor, await reportFor(root, gate))).accepted, false);
});
test('sessions and concurrent worktrees keep separate receipts and approval', async t => {
  const { root, gate } = await fixture(t);
  await exec('git', ['-C', root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-m', 'fixture']);
  const worktree = `${root}-worktree`;
  t.after(() => rm(worktree, { recursive: true, force: true }));
  await exec('git', ['-C', root, 'worktree', 'add', '--detach', worktree]);
  const other = new AuditGate(worktree, 'session', 'parent', async () => []);
  const sameRoot = new AuditGate(root, 'other-session', 'parent', async () => []);
  await other.start(); await sameRoot.start();
  assert.notEqual(gate.receiptDir, other.receiptDir);
  assert.notEqual(gate.receiptDir, sameRoot.receiptDir);
  await writeFile(join(root, 'ui/base.tsx'), 'changed');
  assert.equal((await gate.submit(auditor, await reportFor(root, gate))).accepted, true);
  assert.equal((await sameRoot.stop()).decision, 'block');
  assert.equal(await other.stop(), undefined);
});
test('manifests, policy, host, runtime, plugin CSS are relevant; Go is not', () => {
  for (const file of ['ui/View.tsx', 'packages/runtime/src/View.tsx', 'plugins/example/ui/style.css', 'package.json', 'packages/runtime/package.json', '.omp/agents/omniview-ui-auditor.md', '.omp/hooks/pre/ui-audit.ts', '.omp/skills/omniview-ui-implementation/SKILL.md']) assert.equal(isRelevant(file), true, file);
  assert.equal(isRelevant('pkg/resource/service.go'), false);
});
test('deleted UI files invalidate approval', async t => {
  const { root, gate } = await fixture(t);
  await rm(join(root, 'ui/base.tsx'));
  assert.deepEqual((await gate.pending()).changed, ['ui/base.tsx']);
  assert.equal((await gate.stop()).decision, 'block');
});
test('failed replacement report revokes approval and returns persisted receipt path', async t => {
  const { root, gate } = await fixture(t);
  await writeFile(join(root, 'ui/base.tsx'), 'edit');
  const report = await reportFor(root, gate);
  const accepted = await gate.submit(auditor, report);
  assert.equal(accepted.accepted, true);
  assert.equal(JSON.parse(await readFile(accepted.receiptPath, 'utf8')).accepted, true);
  for (const key of ['findings', 'libraryRequests', 'evidence', 'unverified']) {
    const rejected = await gate.submit(auditor, { ...report, [key]: 'not an array' });
    assert.equal(rejected.accepted, false);
    assert.ok(rejected.errors.includes(`${key} must be an array.`));
    assert.equal((await gate.stop()).decision, 'block');
  }
});
test('static checker visits affected files once per snapshot', async t => {
  const calls = [];
  const { root, gate } = await fixture(t, async (_root, files) => { calls.push(files); return []; });
  assert.deepEqual(calls, [['ui/base.tsx']]);
  await gate.pending();
  assert.equal(calls.length, 1);
  await writeFile(join(root, 'ui/new.tsx'), 'new');
  await gate.pending(); await gate.pending();
  assert.deepEqual(calls, [['ui/base.tsx'], ['ui/new.tsx']]);
});
test('skill evaluation workspaces never invalidate approval', () => {
  for (const file of ['.omp/skills/omniview-ui-implementation-workspace/iteration-1/report.json', '.omp/skills/omniview-ui-implementation-workspace/example.tsx']) {
    assert.equal(isRelevant(file), false, file);
  }
});
async function workspaceFixture(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ui-audit-workspace-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const host = join(base, 'host'), plugin = join(base, 'plugin');
  for (const root of [host, plugin]) {
    await mkdir(root);
    await exec('git', ['init', root]);
    await mkdir(join(root, 'ui'));
    await writeFile(join(root, 'ui/style.css'), 'body {}');
  }
  const manifestPath = join(base, 'workspace.json');
  const manifest = { schemaVersion: 1, repositories: [{ id: 'host', directory: 'host' }, { id: 'plugin', directory: 'plugin' }] };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const calls = [];
  const gate = new AuditGate(host, 'session', 'parent', async (root, files) => { calls.push({ root, files }); return []; });
  await gate.start();
  return { base, host, plugin, manifestPath, manifest, gate, calls };
}
test('explicit workspace includes sibling plugin CSS and checks each Git root locally', async t => {
  const { host, plugin, gate, calls } = await workspaceFixture(t);
  assert.equal(await gate.stop(), undefined);
  assert.deepEqual(calls.map(call => call.files), [['ui/style.css'], ['ui/style.css']]);
  await writeFile(join(plugin, 'ui/style.css'), 'body { color: red; }');
  const pending = await gate.pending();
  assert.deepEqual(pending.changed, ['plugin/ui/style.css']);
  assert.deepEqual(pending.roots.map(selected => selected.root), [host, plugin]);
  assert.deepEqual(calls.at(-1), { root: plugin, files: ['ui/style.css'] });
  assert.equal((await gate.submit(auditor, await reportFor(host, gate))).accepted, true);
  await writeFile(join(plugin, 'ui/style.css'), 'body { color: blue; }');
  assert.equal((await gate.stop()).decision, 'block');
});
test('workspace manifest content changes invalidate approval', async t => {
  const { host, plugin, manifestPath, manifest, gate } = await workspaceFixture(t);
  await writeFile(join(plugin, 'ui/style.css'), 'changed');
  assert.equal((await gate.submit(auditor, await reportFor(host, gate))).accepted, true);
  await writeFile(manifestPath, JSON.stringify({ ...manifest, description: 'changed workspace policy' }));
  assert.ok((await gate.pending()).changed.includes('@workspace/workspace.json'));
  assert.equal((await gate.stop()).decision, 'block');
});
test('workspace selection rejects duplicate roots, escaping paths, and non-Git-root directories', async t => {
  const { manifestPath, manifest, gate } = await workspaceFixture(t);
  for (const entry of [
    { id: 'duplicate', directory: 'plugin' },
    { id: 'escape', directory: '..' },
    { id: 'nested', directory: 'plugin/ui' },
    { id: 'host', directory: 'plugin' },
  ]) {
    await writeFile(manifestPath, JSON.stringify({ ...manifest, repositories: [...manifest.repositories, entry] }));
    await assert.rejects(gate.pending());
  }
});
test('workspace without explicit current-root selection does not guess siblings', async t => {
  const { plugin, manifestPath, gate } = await workspaceFixture(t);
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, repositories: [{ id: 'plugin', directory: 'plugin' }] }));
  const pending = await gate.pending();
  assert.equal(pending.roots.length, 1);
  assert.equal(pending.roots[0].root, gate.root);
  await writeFile(join(plugin, 'ui/style.css'), 'not selected');
  assert.equal((await gate.pending()).snapshot, pending.snapshot);
});
test('runtime low or missing effort rejects approval despite report effort claims', async t => {
  const { root, gate } = await fixture(t);
  await writeFile(join(root, 'ui/base.tsx'), 'edit');
  const report = { ...await reportFor(root, gate), thinkingLevel: 'max', model: { provider: 'claimed', id: 'claimed' } };
  for (const thinkingLevel of ['low', undefined]) {
    const identity = { ...auditor, thinkingLevel };
    assert.equal((await gate.inspect(identity)).snapshot, report.snapshot);
    const receipt = await gate.submit(identity, report);
    assert.equal(receipt.accepted, false);
    assert.equal(receipt.auditor.thinkingLevel, thinkingLevel);
    assert.deepEqual(receipt.auditor.model, auditor.model);
    assert.ok(receipt.errors.some(error => error.includes('effective thinkingLevel')));
  }
  const receipt = await gate.submit({ ...auditor, model: undefined }, report);
  assert.equal(receipt.accepted, false);
  assert.ok(receipt.errors.some(error => error.includes('model provider/id unavailable')));
});
test('resume retains initial baseline and never restores receipt approval', async t => {
  const { root, gate } = await fixture(t);
  await writeFile(join(root, 'ui/base.tsx'), 'session edit');
  const resumed = new AuditGate(root, 'session', 'parent', async () => { throw new Error('Baseline checker must not rerun'); });
  await resumed.start();
  assert.equal(resumed.baseline.id, gate.baseline.id);
  assert.deepEqual((await gate.pending()).changed, ['ui/base.tsx']);
  const active = new AuditGate(root, 'session', 'parent', async () => []);
  await active.start();
  assert.equal((await active.stop()).decision, 'block');
  assert.equal((await active.submit(auditor, await reportFor(root, active))).accepted, true);
  const nextResume = new AuditGate(root, 'session', 'parent', async () => []);
  await nextResume.start();
  assert.equal((await nextResume.stop()).decision, 'block');
});
test('new forbidden import identity cannot subtract an old identical rule message', async t => {
  let identity = 'old-module';
  const { root, gate } = await fixture(t, async () => [{ rule: 'import', file: 'ui/base.tsx', line: 1, message: 'forbidden import', identity }]);
  identity = 'new-module';
  await writeFile(join(root, 'ui/base.tsx'), 'new forbidden import');
  assert.equal((await gate.pending()).findings.length, 1);
});
test('resolved and approved-exception ledgers retain references; open entries block', async t => {
  const { root, gate } = await fixture(t);
  await writeFile(join(root, 'ui/base.tsx'), 'session edit');
  const report = await reportFor(root, gate);
  for (const status of ['resolved', 'approved-exception']) {
    const entry = { status, blocking: false, approvalReference: 'issue://410#resolution', message: 'resolved issue' };
    const receipt = await gate.submit(auditor, { ...report, findings: [entry], libraryRequests: [entry] });
    assert.equal(receipt.accepted, true);
    assert.deepEqual(receipt.report.findings, [entry]);
    for (const patch of [{ status: 'open' }, { blocking: true }, { approvalReference: '' }, { approvalReference: undefined }]) {
      assert.equal((await gate.submit(auditor, { ...report, findings: [{ ...entry, ...patch }] })).accepted, false);
    }
  }
});
test('selected sibling src TypeScript edits invalidate approval', async t => {
  const { plugin, gate } = await workspaceFixture(t);
  await mkdir(join(plugin, 'src'));
  await writeFile(join(plugin, 'src/theme.ts'), 'export const theme = {};');
  assert.deepEqual((await gate.pending()).changed, ['plugin/src/theme.ts']);
});
