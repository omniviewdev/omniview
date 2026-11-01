// Candidate source admission is separate from published release dependency policy.
import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Independently reviewed isolation-core baseline; candidate/tag selection cannot replace this trust decision.
export const isolationBaseline = '5b3ef764d1cf738835a723a749a0cb6c45f85e44';
// Independently reviewed profiling startup; original isolation ancestry remains required.
export const reviewedIsolationCheckpoint = 'eb0d5c8c533c6501c4a57da338435956f82d7b84';
const isolationFiles = ['pkg/state/root.go', 'pkg/state/custom.go', 'pkg/profilecontract/profile.go', 'pkg/utils/store.go', 'pkg/sdk/plugin.go'];

export function verifyIsolation(source, git) {
  git(source, ['merge-base', '--is-ancestor', isolationBaseline, reviewedIsolationCheckpoint]);
  git(source, ['merge-base', '--is-ancestor', reviewedIsolationCheckpoint, 'HEAD']);
  for (const path of isolationFiles) {
    if (git(source, ['show', `${reviewedIsolationCheckpoint}:${path}`]) !== git(source, ['show', `HEAD:${path}`])) {
      throw Error(`Candidate SDK changes independently reviewed isolation core: ${path}`);
    }
  }
}
export function admitCandidate(cohort, env) {
  if (!cohort || typeof cohort !== 'object' || Array.isArray(cohort) || Object.keys(cohort).sort().join(',') !== 'kubernetes,plugin-sdk,ui') {
    throw Error('Candidate cohort must contain exactly plugin-sdk, ui and kubernetes');
  }
  for (const id of ['plugin-sdk', 'ui', 'kubernetes']) {
    if (!/^[a-f0-9]{40}$/.test(cohort?.[id] ?? '')) throw Error(`Missing immutable candidate ${id} commit`);
  }
  if (env.REVIEWED_SDK_REVISION !== cohort['plugin-sdk']) {
    const approved = /^[a-f0-9]{40}$/.test(env.REVIEWED_SDK_REVISION ?? '')
      ? env.REVIEWED_SDK_REVISION : '(unset or invalid)';
    throw Error(`Candidate SDK ${cohort['plugin-sdk']} differs from independently approved SDK ${approved} in REVIEWED_SDK_REVISION (CI maps repository variable OMNIVIEW_RESOURCE_V2_REVIEWED_SDK_REVISION); select the approved candidate pin before preparation. Approval authority was not changed.`);
  }
  for (const [key, id] of [['UI_SOURCE_REF', 'ui'], ['KUBERNETES_SOURCE_REF', 'kubernetes']]) {
    if (env[key] && env[key] !== cohort[id]) throw Error(`${key} conflicts with checked-in candidate cohort`);
  }
  return { sdk: cohort['plugin-sdk'], ui: cohort.ui, kubernetes: cohort.kubernetes };
}

export function verifyGitlink(refs, entry) {
  if (entry.trim() !== `160000 commit ${refs.kubernetes}\tplugins/kubernetes`) throw Error('Kubernetes gitlink differs from reviewed candidate cohort');
}

export function verifyCandidate(refs, sources, git) {
  for (const [id, path] of Object.entries(sources)) {
    if (!path || git(path, ['rev-parse', 'HEAD']).trim() !== refs[id]) throw Error(`Candidate ${id} checkout differs from reviewed cohort`);
    if (git(path, ['status', '--porcelain', '--untracked-files=all']).trim()) throw Error(`Candidate ${id} source is not clean`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const refs = admitCandidate(JSON.parse(readFileSync(resolve(root, 'e2e/source-cohort.json'), 'utf8')), process.env);
  const git = (path, args) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' });
  if (process.argv[2] === 'verify-sdk') {
    verifyCandidate(refs, { sdk: process.env.SDK_SOURCE }, git);
    verifyIsolation(process.env.SDK_SOURCE, git);
  } else if (process.argv[2] === 'resolve') {
    verifyGitlink(refs, git(root, ['ls-tree', 'HEAD', 'plugins/kubernetes']));
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(refs).map(([key, value]) => `${key}=${value}\n`).join(''));
  } else if (process.argv[2] === 'verify') {
    verifyCandidate(refs, { sdk: process.env.SDK_SOURCE, ui: process.env.UI_SOURCE, kubernetes: process.env.KUBERNETES_SOURCE }, git);
    verifyIsolation(process.env.SDK_SOURCE, git);
  } else throw Error('Expected resolve, verify-sdk or verify');
}
