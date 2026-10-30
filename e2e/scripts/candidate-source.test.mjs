import assert from 'node:assert/strict';
import test from 'node:test';
import { admitCandidate, verifyCandidate, verifyIsolation, isolationBaseline, verifyGitlink } from './candidate-source.mjs';

const cohort = { 'plugin-sdk': 'a'.repeat(40), ui: 'b'.repeat(40), kubernetes: 'c'.repeat(40) };
const env = { REVIEWED_SDK_REVISION: cohort['plugin-sdk'] };
test('candidate admission requires independent exact SDK approval, not a tag or default', () => {
  assert.deepEqual(admitCandidate(cohort, env), { sdk: cohort['plugin-sdk'], ui: cohort.ui, kubernetes: cohort.kubernetes });
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
test('candidate verification rejects wrong, dirty and missing source checkouts', () => {
  const refs = admitCandidate(cohort, env);
  const sources = { sdk: '/sdk', ui: '/ui', kubernetes: '/kubernetes' };
  const git = (path, args) => args[0] === 'rev-parse' ? refs[path.slice(1)] : '';
  assert.doesNotThrow(() => verifyCandidate(refs, sources, git));
  assert.throws(() => verifyCandidate(refs, { ...sources, sdk: '' }, git));
  assert.throws(() => verifyCandidate(refs, sources, () => 'd'.repeat(40)));
  assert.throws(() => verifyCandidate(refs, sources, (path, args) => args[0] === 'status' ? ' M go.mod' : git(path, args)));
});

test('independent isolation review stays distinct from candidate source approval', () => {
  const git = (_source, args) => args[0] === 'show' ? 'reviewed bytes' : '';
  assert.doesNotThrow(() => verifyIsolation('/sdk', git));
  assert.throws(() => verifyIsolation('/sdk', (_source, args) => {
    if (args[0] === 'merge-base') throw Error('not a reviewed descendant');
    return 'reviewed bytes';
  }));
  assert.throws(() => verifyIsolation('/sdk', (_source, args) => {
    if (args[0] !== 'show') return '';
    return args[1].startsWith(isolationBaseline) ? 'reviewed bytes' : 'changed isolation';
  }));
});

test('candidate Kubernetes source must equal the committed gitlink, not an unrelated checkout or ordinary tree', () => {
  const refs = admitCandidate(cohort, env);
  assert.doesNotThrow(() => verifyGitlink(refs, `160000 commit ${refs.kubernetes}\tplugins/kubernetes\n`));
  for (const entry of ['', `160000 commit ${'d'.repeat(40)}\tplugins/kubernetes`, `040000 tree ${refs.kubernetes}\tplugins/kubernetes`]) {
    assert.throws(() => verifyGitlink(refs, entry));
  }
});
