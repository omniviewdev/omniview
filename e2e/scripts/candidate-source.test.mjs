import assert from 'node:assert/strict';
import test from 'node:test';
import { admitCandidate, verifyCandidate, verifyIsolation, isolationBaseline, reviewedIsolationCheckpoint, verifyGitlink } from './candidate-source.mjs';

const cohort = { 'plugin-sdk': 'a'.repeat(40), ui: 'b'.repeat(40), kubernetes: 'c'.repeat(40) };
const env = { REVIEWED_SDK_REVISION: cohort['plugin-sdk'] };
test('candidate admission requires independent exact SDK approval, not a tag or default', () => {
  assert.deepEqual(admitCandidate(cohort, env), { sdk: cohort['plugin-sdk'], ui: cohort.ui, kubernetes: cohort.kubernetes });
  const updatedUI = 'e'.repeat(40);
  assert.deepEqual(admitCandidate({ ...cohort, ui: updatedUI }, env), { sdk: cohort['plugin-sdk'], ui: updatedUI, kubernetes: cohort.kubernetes });
  for (const revision of [undefined, '', 'v0.7.1', 'main', 'd'.repeat(40)]) {
    assert.throws(() => admitCandidate(cohort, { REVIEWED_SDK_REVISION: revision }));
  }
  for (const id of Object.keys(cohort)) assert.throws(() => admitCandidate({ ...cohort, [id]: 'main' }, env));
  for (const invalid of [null, [], { ...cohort, extra: 'd'.repeat(40) }]) {
    assert.throws(() => admitCandidate(invalid, env));
  }
  assert.throws(() => admitCandidate(cohort, { ...env, UI_SOURCE_REF: 'd'.repeat(40) }));
  assert.throws(() => admitCandidate(cohort, { ...env, KUBERNETES_SOURCE_REF: 'd'.repeat(40) }));
});
test('candidate admission rejects numeric commit identities and missing cohort members', () => {
  for (const id of Object.keys(cohort)) {
    assert.throws(() => admitCandidate({ ...cohort, [id]: 123 }, env));
    const incomplete = { ...cohort };
    delete incomplete[id];
    assert.throws(() => admitCandidate(incomplete, env));
  }
});
test('candidate verification rejects wrong, dirty and missing source checkouts', () => {
  const refs = admitCandidate(cohort, env);
  const sources = { sdk: '/sdk', ui: '/ui', kubernetes: '/kubernetes' };
  const git = (path, args) => args[0] === 'rev-parse' ? refs[path.slice(1)] : '';
  assert.doesNotThrow(() => verifyCandidate(refs, sources, git));
  assert.throws(() => verifyCandidate(refs, { ...sources, sdk: '' }, git));
  assert.throws(() => verifyCandidate(refs, sources, () => 'd'.repeat(40)));
  assert.throws(() => verifyCandidate(refs, sources, (path, args) => args[0] === 'status' ? ' M go.mod' : git(path, args)));
});

const baselineCommit = '5b3ef764d1cf738835a723a749a0cb6c45f85e44';
const checkpointCommit = reviewedIsolationCheckpoint;
const protectedPaths = ['pkg/state/root.go', 'pkg/state/custom.go', 'pkg/profilecontract/profile.go', 'pkg/utils/store.go', 'pkg/sdk/plugin.go'];

function isolationRepository() {
  const baselineTree = Object.fromEntries(protectedPaths.map(path => [path, `baseline contents of ${path}`]));
  const reviewedTree = Object.fromEntries(protectedPaths.map(path => [path, `reviewed contents of ${path}`]));
  const commits = new Map([
    [baselineCommit, { parent: null, tree: baselineTree }],
    [checkpointCommit, { parent: baselineCommit, tree: reviewedTree }],
    ['candidate', { parent: checkpointCommit, tree: { ...reviewedTree } }],
  ]);
  let head = 'candidate';
  const git = (_source, args) => {
    const revision = ref => ref === 'HEAD' ? head : ref;
    if (args[0] === 'merge-base') {
      assert.equal(args[1], '--is-ancestor');
      const ancestor = revision(args[2]);
      let current = revision(args[3]);
      if (!commits.has(ancestor) || !commits.has(current)) throw Error('missing commit');
      while (current && current !== ancestor) current = commits.get(current)?.parent;
      if (current !== ancestor) throw Error('not an ancestor');
      return '';
    }
    assert.equal(args[0], 'show');
    const [ref, path] = args[1].split(':');
    const contents = commits.get(revision(ref))?.tree[path];
    if (contents === undefined) throw Error('missing protected blob');
    return contents;
  };
  return { commits, git, setHead: ref => { head = ref; } };
}

test('separate reviewed checkpoint preserves the original ancestry minimum and accepts its unchanged descendants', () => {
  assert.equal(isolationBaseline, baselineCommit);
  const repository = isolationRepository();
  assert.doesNotThrow(() => verifyIsolation('/sdk', repository.git));
  repository.setHead(checkpointCommit);
  assert.doesNotThrow(() => verifyIsolation('/sdk', repository.git));
});

test('each protected file remains byte-sensitive against the pinned checkpoint, not candidate approval', () => {
  for (const path of protectedPaths) {
    const repository = isolationRepository();
    repository.commits.get('candidate').tree[path] += '\nunauthorized change';
    assert.throws(() => verifyIsolation('/sdk', repository.git), /changes independently reviewed isolation core/);
  }
});

test('isolation admission rejects broken baseline ancestry, pre-checkpoint heads and an unavailable pinned checkpoint', () => {
  const disconnected = isolationRepository();
  disconnected.commits.get(checkpointCommit).parent = null;
  assert.throws(() => verifyIsolation('/sdk', disconnected.git), /not an ancestor/);
  const oldHead = isolationRepository();
  oldHead.setHead(baselineCommit);
  assert.throws(() => verifyIsolation('/sdk', oldHead.git), /not an ancestor/);
  const substituted = isolationRepository();
  substituted.commits.set('unreviewed-checkpoint', substituted.commits.get(checkpointCommit));
  substituted.commits.delete(checkpointCommit);
  substituted.commits.get('candidate').parent = 'unreviewed-checkpoint';
  assert.throws(() => verifyIsolation('/sdk', substituted.git), /missing commit/);
});

test('candidate Kubernetes source must equal the committed gitlink, not an unrelated checkout or ordinary tree', () => {
  const refs = admitCandidate(cohort, env);
  assert.doesNotThrow(() => verifyGitlink(refs, `160000 commit ${refs.kubernetes}\tplugins/kubernetes\n`));
  for (const entry of ['', `160000 commit ${'d'.repeat(40)}\tplugins/kubernetes`, `040000 tree ${refs.kubernetes}\tplugins/kubernetes`]) {
    assert.throws(() => verifyGitlink(refs, entry));
  }
});
