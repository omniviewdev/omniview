import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function copyCommittedSource({ source, ref, destination, execute }) {
  const head = () => execute('git', ['-C', source, 'rev-parse', 'HEAD'], { capture: true });
  if (head() !== ref) throw Error('Selected source changed before private cohort copying');
  execute('git', ['clone', '--depth', '1', '--no-local', '--no-hardlinks', '--no-checkout', '--', source, destination]);
  execute('git', ['-C', destination, 'checkout', '--detach', ref]);
  if (execute('git', ['-C', destination, 'rev-parse', 'HEAD'], { capture: true }) !== ref || head() !== ref) throw Error('Selected source identity changed during private cohort copying');
}

export function prepareApplicationCohort({ privateRoot, sources, refs, env, execute, phase }) {
  const directory = join(privateRoot, 'build-cohort');
  const originals = { ...sources };
  const copies = {};
  mkdirSync(directory, { mode: 0o700 });
  const copyRoot = join(directory, 'sources');
  mkdirSync(copyRoot, { mode: 0o700 });
  phase('committed-private-source-copies', () => {
    for (const [id, source] of Object.entries(sources)) {
      copies[id] = join(copyRoot, id);
      copyCommittedSource({ source, ref: refs[id], destination: copies[id], execute });
    }
  });
  const hostmodDirectory = join(directory, 'hostmod');
  mkdirSync(hostmodDirectory, { mode: 0o700 });
  const modfile = phase('cohort-host-module', () => execute('task', ['--silent', 'host:prepare', `SDK_SOURCE=${copies['plugin-sdk']}`, `HOST_MOD_OUTPUT_DIRECTORY=${hostmodDirectory}`, `GO_BUILD_CACHE_DIRECTORY=${env.GOCACHE}`], { capture: true }));
  const evidence = join(directory, 'native-link-protocol.json');
  const nativeEnvironment = env.OMNIVIEW_E2E_PNPM_EXECUTABLE ? { OMNIVIEW_PNPM_EXECUTABLE: env.OMNIVIEW_E2E_PNPM_EXECUTABLE } : {};
  phase('real-native-composition-protocol-proof', () => execute('go', ['test', `-modfile=${modfile}`, '-tags', 'server', './internal/devworkspace', '-run', '^TestLinkPinnedProtocolProbe$', '-count=1'], { timeout: 180_000, extraEnv: { ...nativeEnvironment, A11_PROTOCOL_PROBE: '1', A11_PROTOCOL_REPORT: evidence } }));
  const observed = JSON.parse(readFileSync(evidence, 'utf8'));
  if (observed.protocol !== 'workspace' || observed.versions?.length !== 1 || observed.versions[0] !== '12.14.0' || !observed.atomicDist || !observed.peers || !observed.runtime) throw Error('Real native composition protocol proof did not satisfy admission');
  const tool = join(directory, 'cohort-tool');
  phase('cohort-adapter-build', () => execute('go', ['build', `-modfile=${modfile}`, '-tags', 'server,e2eapplication', '-o', tool, './e2e/cohort']));
  const config = join(directory, 'cohort.json');
  writeFileSync(config, JSON.stringify({ root: join(directory, 'collection'), sources: copies, refs, evidence }), { mode: 0o600, flag: 'wx' });
  const prepared = phase('canonical-native-cohort-link', () => JSON.parse(execute(tool, ['prepare', config], { capture: true, timeout: 240_000, extraEnv: nativeEnvironment })));
  if (!prepared.paths?.repositories?.ui || !prepared.paths.repositories['plugin-sdk'] || !prepared.program || prepared.args?.length !== 1) throw Error('Canonical cohort did not provide selected sources and native package command');
  const cohort = { tool, config, originals, refs, nativeEnvironment, sources: prepared.paths.repositories, ...prepared };
  writeFileSync(join(directory, 'prepared.json'), JSON.stringify(cohort), { mode: 0o600, flag: 'wx' });
  return cohort;
}

export function cohortEnvironment(cohort, env) {
  return { ...env, SDK_SOURCE: cohort.sources['plugin-sdk'], ...(env.OMNIVIEW_E2E_PNPM_EXECUTABLE ? { OMNIVIEW_PNPM_EXECUTABLE: env.OMNIVIEW_E2E_PNPM_EXECUTABLE } : {}) };
}

export function verifyApplicationCohort(cohort, execute) {
  return JSON.parse(execute(cohort.tool, ['verify', cohort.config], { capture: true, timeout: 60_000 }));
}

export function buildApplicationPluginUI(cohort, pluginID, execute) {
  return JSON.parse(execute(cohort.tool, ['build-plugin-ui', cohort.config, pluginID], { capture: true, timeout: 240_000, extraEnv: cohort.nativeEnvironment }));
}

export function retireApplicationCohort(cohort, execute) {
  // This owned fixture may contain compiler caches in generated dependency trees.
  // Opt into canonical delete-only module recovery; never relax output ownership.
  return JSON.parse(execute(cohort.tool, ['retire', cohort.config, '--reset-modules'], { capture: true, timeout: 60_000, extraEnv: cohort.nativeEnvironment }));
}
