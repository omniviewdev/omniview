// The staleness guard of the CI image (scripts/ci/check-image.mjs): the parsers of the repository's pins, the hash of the image's inputs, the lock and the pins that follow it, the
// manifest of a running image, and the command itself in throwaway repositories. Each drift the guard exists for is made for real and must trip the rule it is named for, and no other.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkManifest,
  checkRepo,
  dockerfileArgs,
  goFloor,
  IMAGE,
  inputsHash,
  parseToolVersions,
  playwrightFromLockfile,
  pnpmFromPackageJson,
  resolveInputs,
  satisfiesGoFloor,
  scanPins,
  versionMatches,
  writeLock,
} from './check-image.mjs';

const script = fileURLToPath(new URL('./check-image.mjs', import.meta.url));
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const TAG = 'ubuntu24-20261120-abcdef0';
const BUILT_AT = '2026-11-20T05:30:00Z';
const NOW = new Date('2026-11-21T00:00:00Z');
const KIND_SHA = '517ab7fc89ddeed5fa65abf71530d90648d9638ef0c4cde22c2c11f8097b8889';
const KUBECTL_SHA = 'a2e984a18a0c063279d692533031c1eff93a262afcc0afdc517375432d060989';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** The definition of the inputs hash, restated here on purpose: the script must produce exactly this, so a change to the definition is a change to this test. */
const specHash = (i) => sha256(JSON.stringify({ schema: 1, dockerfile_sha256: i.dockerfile_sha256, node: i.node, pnpm: i.pnpm, playwright: i.playwright, go_floor: i.go_floor }));

const DOCKERFILE = `ARG NODE_VERSION
FROM node:\${NODE_VERSION}-bookworm-slim AS node

FROM ubuntu:24.04
ARG NODE_VERSION
ARG PNPM_VERSION
ARG PLAYWRIGHT_VERSION
ARG GO_VERSION=1.27.3
ARG GOLANGCI_LINT_VERSION=v2.15.0
ARG KIND_VERSION=v0.30.0
ARG KIND_SHA256=${KIND_SHA}
ARG KUBECTL_VERSION=v1.35.0
ARG KUBECTL_SHA256=${KUBECTL_SHA}
RUN echo hello
`;

/** The shape of the real pnpm-lock.yaml: a first document for pnpm itself, then the project's. Peer-suffixed keys live only in `snapshots`. */
const lockfile = (version = '1.64.1', extra = '') => `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.14.0
        version: 12.14.0

packages:

  pnpm@12.14.0:
    resolution: {integrity: sha512-aaa}

snapshots:

  pnpm@12.14.0: {}

---
lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      playwright:
        specifier: ${version}
        version: ${version}

packages:

  '@playwright/test@${version}':
    resolution: {integrity: sha512-bbb}
    engines: {node: '>=20'}
    hasBin: true

  playwright-core@${version}:
    resolution: {integrity: sha512-ccc}

  playwright@${version}:
    resolution: {integrity: sha512-ddd}

  pngjs@7.0.0:
    resolution: {integrity: sha512-eee}
${extra}
snapshots:

  '@vitest/browser-playwright@5.0.5(playwright@${version})(vite@7.3.7)(vitest@5.0.5)':
    dependencies:
      playwright: ${version}

  playwright-core@${version}: {}
`;

const GO_MOD = 'module github.com/omniviewdev/omniview\n\ngo 1.27.0\n\nrequire (\n\tcel.dev/cel-go v0.33.1\n)\n';
const TOOL_VERSIONS = 'pnpm 12.14.0\nnodejs 26.13.0\ngolang 1.26.1\n';
const PACKAGE_JSON = JSON.stringify({ name: 'omniview', packageManager: 'pnpm@12.14.0' });

const workflow = (image) => `name: consumer
jobs:
  go-checks:
    runs-on: ubuntu-24.04
    container:
      image: ${image}
      options: --init
`;
/** The lint step of PR Checks as it is today: the action downloads golangci-lint at the version in `with`. */
const lintStep = (version) => `      - name: Lint
        uses: golangci/golangci-lint-action@v9
        with:
          version: ${version}
          only-new-issues: false
        env:
          GOWORK: "off"
  other:
    steps:
      - uses: actions/checkout@v4
        with:
          version: v9.9.9
`;
const PODS = `name: pods
env:
  NODE_VERSION: "26.13.0"
  GO_VERSION: "1.27.3"
  KIND_VERSION: v0.30.0
  KIND_SHA256: ${KIND_SHA}
  KUBECTL_VERSION: v1.35.0
  KUBECTL_SHA256: ${KUBECTL_SHA}
`;

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function put(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/** What `docker run <image> cat /opt/ci/manifest.json` prints for an image built from the repository `root`'s inputs. */
function manifestFor(inputs, over = {}) {
  return {
    schema: 1,
    image: IMAGE,
    built_at: BUILT_AT,
    source: { repository: 'omniviewdev/omniview', sha: 'abcdef0123456789abcdef0123456789abcdef01', run: 'https://github.com/omniviewdev/omniview/actions/runs/1' },
    inputs_sha256: specHash(inputs),
    dockerfile_sha256: inputs.dockerfile_sha256,
    os: { id: 'ubuntu', version: '24.04' },
    tools: { node: inputs.node, pnpm: inputs.pnpm, playwright: inputs.playwright, go: '1.27.3', task: 'v3.54.0', goimports: 'v0.53.0', 'golangci-lint': 'v2.15.0', kind: 'v0.30.0', kubectl: 'v1.35.0' },
    browsers: {
      path: '/ms-playwright',
      chromium: { revision: '1194', version: '141.0.7390.37' },
      'chromium-headless-shell': { revision: '1194', version: '141.0.7390.37' },
      webkit: { revision: '2227', version: '26.0' },
    },
    ...over,
  };
}

/**
 * A throwaway repository whose pins agree with each other and with its lock (the lock is built from the spec above, not from the script). `over` replaces a file's text;
 * `lock: null` leaves no lock, a string is written as is, an object is merged over the consistent lock.
 */
function repository(over = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-image-'));
  roots.push(root);
  const dockerfile = over.dockerfile ?? DOCKERFILE;
  put(root, '.github/ci/Dockerfile', dockerfile);
  put(root, '.tool-versions', over.toolVersions ?? TOOL_VERSIONS);
  put(root, 'package.json', over.packageJson ?? PACKAGE_JSON);
  put(root, 'go.mod', over.goMod ?? GO_MOD);
  put(root, 'pnpm-lock.yaml', over.lockfile ?? lockfile());
  put(root, '.github/workflows/pr.yml', over.pr ?? workflow(`${IMAGE}@${DIGEST_A}`));
  put(root, '.github/workflows/pr-checks.yml', over.prChecks ?? `${workflow(`${IMAGE}@${DIGEST_A}`)}${lintStep('v2.15.0')}`);
  put(root, '.github/workflows/ui-next-pods.yml', over.pods ?? PODS);
  put(root, '.github/workflows/ci-image.yml', `env:\n  IMAGE: ${IMAGE}\n# consumers pin ${IMAGE}@sha256:<digest>\n`);

  if (over.lock !== null) {
    // The inputs the lock was built from: the repository as it is now, unless `lockedFrom` says it was built from another state.
    const from = { dockerfile_sha256: sha256(over.lockedDockerfile ?? dockerfile), node: '26.13.0', pnpm: '12.14.0', playwright: '1.64.1', go_floor: '1.27.0', ...over.lockedFrom };
    const lock = {
      schema: 1,
      image: IMAGE,
      tag: TAG,
      digest: DIGEST_A,
      inputs: { schema: 1, ...from, sha256: specHash(from) },
      manifest: manifestFor(from),
      ...(typeof over.lock === 'object' ? over.lock : {}),
    };
    put(root, '.github/ci/image.lock', typeof over.lock === 'string' ? over.lock : `${JSON.stringify(lock, null, 2)}\n`);
  }
  return root;
}

const codes = (report) => report.problems.map((problem) => problem.code).sort();
const warningCodes = (report) => report.warnings.map((warning) => warning.code).sort();
const current = (root) => resolveInputs(root).inputs;

// ---- what the repository pins -------------------------------------------------------------------------------------------------------------------------------------------------

test('the lockfile resolves Playwright once: playwright, playwright-core and @playwright/test agree, and the peer-suffixed snapshot keys are not read', () => {
  const found = playwrightFromLockfile(lockfile('1.64.1'));
  assert.equal(found.version, '1.64.1');
  assert.deepEqual(found.problems, []);
});

test('NEGATIVE CONTROL: two Playwright versions in the lockfile are ambiguous, because the image holds the browsers of one', () => {
  const found = playwrightFromLockfile(lockfile('1.64.1', '\n  playwright-core@1.63.0:\n    resolution: {integrity: sha512-fff}\n'));
  assert.equal(found.version, null);
  assert.deepEqual(found.problems.map((problem) => problem.code), ['playwright-ambiguous']);
  assert.match(found.problems[0].message, /1\.63\.0/);
  assert.match(found.problems[0].message, /1\.64\.1/);
});

test('NEGATIVE CONTROL: playwright and playwright-core on different versions are ambiguous', () => {
  const skewed = lockfile('1.64.1').replace('playwright-core@1.64.1:', 'playwright-core@1.64.0:');
  const found = playwrightFromLockfile(skewed);
  assert.equal(found.version, null);
  assert.deepEqual(found.problems.map((problem) => problem.code), ['playwright-ambiguous']);
});

test('a lockfile without Playwright says so instead of passing', () => {
  const found = playwrightFromLockfile("---\nlockfileVersion: '9.0'\n\npackages:\n\n  pngjs@7.0.0:\n    resolution: {integrity: sha512-eee}\n");
  assert.equal(found.version, null);
  assert.deepEqual(found.problems.map((problem) => problem.code), ['playwright-missing']);
});

test('.tool-versions gives Node and ignores the lines it does not own, comments and blanks', () => {
  assert.deepEqual(parseToolVersions('# tools\npnpm 12.14.0\n\nnodejs 26.13.0   # the CI pin\ngolang 1.26.1\n'), { pnpm: '12.14.0', nodejs: '26.13.0', golang: '1.26.1' });
});

test('packageManager gives the pnpm version without its integrity suffix, and nothing for another manager', () => {
  assert.equal(pnpmFromPackageJson('{"packageManager":"pnpm@12.14.0"}'), '12.14.0');
  assert.equal(pnpmFromPackageJson('{"packageManager":"pnpm@12.14.0+sha512.abc123"}'), '12.14.0');
  assert.equal(pnpmFromPackageJson('{"packageManager":"yarn@4.1.0"}'), null);
  assert.equal(pnpmFromPackageJson('{}'), null);
});

test('the Go floor is the go directive, raised by a toolchain directive, and a missing patch is .0', () => {
  assert.equal(goFloor('module m\n\ngo 1.27.0\n'), '1.27.0');
  assert.equal(goFloor('module m\n\ngo 1.27\n'), '1.27.0');
  assert.equal(goFloor('module m\n\ngo 1.27.0\ntoolchain go1.27.3\n'), '1.27.3');
  assert.equal(goFloor('module m\n'), null);
});

test('Dockerfile ARGs: a value is a default, no value is a required build argument', () => {
  const args = dockerfileArgs(DOCKERFILE);
  assert.equal(args.GO_VERSION, '1.27.3');
  assert.equal(args.KIND_VERSION, 'v0.30.0');
  assert.equal(args.PNPM_VERSION, null);
  assert.equal(Object.hasOwn(args, 'PNPM_VERSION'), true);
  assert.equal(Object.hasOwn(args, 'NOT_DECLARED'), false);
});

test('version rules: a spec is a prefix of dotted components, the Go floor is the same minor at or above the floor patch', () => {
  assert.equal(versionMatches('1.27.3', '1.27'), true);
  assert.equal(versionMatches('1.27.3', '1.27.3'), true);
  assert.equal(versionMatches('1.27.3', '1.27.4'), false);
  assert.equal(versionMatches('1.27.3', '1.2'), false);
  assert.equal(versionMatches('v0.30.0', '0.30.0'), true);
  assert.equal(versionMatches('26.13.0', '26'), true);
  assert.equal(satisfiesGoFloor('1.27.3', '1.27.0'), true);
  assert.equal(satisfiesGoFloor('1.27.0', '1.27.0'), true);
  assert.equal(satisfiesGoFloor('1.27.0', '1.27.3'), false);
  assert.equal(satisfiesGoFloor('1.26.1', '1.27.0'), false);
  assert.equal(satisfiesGoFloor('1.28.0', '1.27.0'), false);
});

// ---- the inputs of the image --------------------------------------------------------------------------------------------------------------------------------------------------

test('the inputs are the Dockerfile and what the repository pins, and their hash is the one the spec states', () => {
  const root = repository();
  const { inputs, problems } = resolveInputs(root);
  assert.deepEqual(problems, []);
  assert.deepEqual(inputs, { schema: 1, dockerfile_sha256: sha256(DOCKERFILE), node: '26.13.0', pnpm: '12.14.0', playwright: '1.64.1', go_floor: '1.27.0' });
  assert.equal(inputsHash(inputs), specHash(inputs));
});

test('every input moves the hash, so a change to any of them makes the lock behind', () => {
  const base = current(repository());
  const seen = new Set([inputsHash(base)]);
  for (const change of [{ dockerfile_sha256: sha256('other') }, { node: '26.14.0' }, { pnpm: '12.15.0' }, { playwright: '1.65.0' }, { go_floor: '1.28.0' }]) {
    seen.add(inputsHash({ ...base, ...change }));
  }
  assert.equal(seen.size, 6);
});

test('an input the repository does not state is a problem with its file named, not a silent default', () => {
  const noNode = resolveInputs(repository({ toolVersions: 'pnpm 12.14.0\n' }));
  assert.deepEqual(noNode.problems.map((problem) => problem.code), ['node-missing']);
  assert.match(noNode.problems[0].message, /\.tool-versions/);
  const noPnpm = resolveInputs(repository({ packageJson: '{"name":"x"}' }));
  assert.deepEqual(noPnpm.problems.map((problem) => problem.code), ['pnpm-missing']);
  const noGo = resolveInputs(repository({ goMod: 'module m\n' }));
  assert.deepEqual(noGo.problems.map((problem) => problem.code), ['go-missing']);
});

// ---- the pins in the workflows ------------------------------------------------------------------------------------------------------------------------------------------------

test('the pins are every reference to the image in a workflow: by digest, by tag, and not the bare name or a comment', () => {
  const root = repository({
    pr: workflow(`${IMAGE}@${DIGEST_A}`),
    prChecks: `${workflow(`${IMAGE}:ubuntu24-v1`)}  # was ${IMAGE}@${DIGEST_B}\n      # image: ${IMAGE}@${DIGEST_B}\n`,
  });
  const pins = scanPins(root).map((pin) => ({ file: pin.file, digest: pin.digest ?? null, tag: pin.tag ?? null }));
  assert.deepEqual(pins, [
    { file: '.github/workflows/pr-checks.yml', digest: null, tag: 'ubuntu24-v1' },
    { file: '.github/workflows/pr.yml', digest: DIGEST_A, tag: null },
  ]);
});

// ---- the repository against its lock ------------------------------------------------------------------------------------------------------------------------------------------

test('a repository whose pins, lock and workflows agree passes with nothing to say', () => {
  const report = checkRepo(repository(), { now: NOW });
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.warnings, []);
});

test('NEGATIVE CONTROL: two different digests in the workflows fail, with each file named', () => {
  const root = repository({ prChecks: workflow(`${IMAGE}@${DIGEST_B}`) });
  const report = checkRepo(root, { now: NOW });
  assert.deepEqual(codes(report), ['digest-mismatch', 'digest-split']);
  const split = report.problems.find((problem) => problem.code === 'digest-split');
  assert.match(split.message, /pr\.yml/);
  assert.match(split.message, /pr-checks\.yml/);
});

test('NEGATIVE CONTROL: one digest everywhere but not the lock\'s fails as a mismatch with the lock, not as a split', () => {
  const root = repository({ pr: workflow(`${IMAGE}@${DIGEST_B}`), prChecks: workflow(`${IMAGE}@${DIGEST_B}`) });
  assert.deepEqual(codes(checkRepo(root, { now: NOW })), ['digest-mismatch', 'digest-mismatch']);
});

test('a mutable tag is a warning that names the file, and a problem when digests are required', () => {
  const root = repository({ pr: workflow(`${IMAGE}:ubuntu24-v1`) });
  const lax = checkRepo(root, { now: NOW });
  assert.deepEqual(lax.problems, []);
  assert.deepEqual(warningCodes(lax), ['mutable-pin']);
  assert.match(lax.warnings[0].message, /pr\.yml/);
  assert.deepEqual(codes(checkRepo(root, { now: NOW, requireDigestPins: true })), ['mutable-pin']);
});

test('NEGATIVE CONTROL: the lockfile moves to another Playwright and the image is not rebuilt: the lock is behind and says which version the image holds', () => {
  const root = repository({ lockfile: lockfile('1.65.0') });
  const report = checkRepo(root, { now: NOW });
  assert.deepEqual(codes(report), ['inputs-behind', 'playwright-mismatch']);
  const message = report.problems.find((problem) => problem.code === 'playwright-mismatch').message;
  assert.match(message, /1\.65\.0/);
  assert.match(message, /1\.64\.1/);
  assert.match(report.problems.find((problem) => problem.code === 'inputs-behind').message, /playwright/i);
});

test('NEGATIVE CONTROL: an image whose manifest holds another Playwright than the lockfile trips the Playwright rule alone, even when the inputs hash agrees', () => {
  const root = repository();
  const lock = JSON.parse(readFileSync(path.join(root, '.github/ci/image.lock'), 'utf8'));
  lock.manifest.tools.playwright = '1.63.0';
  put(root, '.github/ci/image.lock', `${JSON.stringify(lock, null, 2)}\n`);
  assert.deepEqual(codes(checkRepo(root, { now: NOW })), ['playwright-mismatch']);
});

test('NEGATIVE CONTROL: a toolchain in the manifest that is not the repository\'s trips its own rule alone: Go below the floor, another Node, another pnpm', () => {
  for (const [tool, value, expected] of [['go', '1.26.1', 'go-mismatch'], ['go', '1.28.0', 'go-mismatch'], ['node', '26.12.0', 'node-mismatch'], ['pnpm', '12.13.0', 'pnpm-mismatch']]) {
    const root = repository();
    const lock = JSON.parse(readFileSync(path.join(root, '.github/ci/image.lock'), 'utf8'));
    lock.manifest.tools[tool] = value;
    put(root, '.github/ci/image.lock', `${JSON.stringify(lock, null, 2)}\n`);
    const report = checkRepo(root, { now: NOW });
    assert.deepEqual(codes(report), [expected], `${tool} ${value}`);
    assert.match(report.problems[0].message, new RegExp(value.replaceAll('.', '\\.')));
  }
});

test('NEGATIVE CONTROL: a Go floor raised in go.mod above what the image holds is a toolchain mismatch, and the lock is behind', () => {
  const root = repository({ goMod: GO_MOD.replace('go 1.27.0', 'go 1.27.5') });
  assert.deepEqual(codes(checkRepo(root, { now: NOW })), ['go-mismatch', 'inputs-behind']);
});

test('NEGATIVE CONTROL: an edited Dockerfile leaves the lock behind, and the report says it is the Dockerfile', () => {
  const root = repository({ dockerfile: `${DOCKERFILE}RUN echo changed\n`, lockedDockerfile: DOCKERFILE });
  const report = checkRepo(root, { now: NOW });
  assert.deepEqual(codes(report), ['inputs-behind']);
  assert.match(report.problems[0].message, /Dockerfile/);
  assert.match(report.problems[0].message, /ci-image\.yml/);
});

test('NEGATIVE CONTROL: a lock that is missing or unreadable is a problem that asks for a rebuild, never a pass', () => {
  assert.deepEqual(codes(checkRepo(repository({ lock: null }), { now: NOW })), ['lock-missing']);
  assert.deepEqual(codes(checkRepo(repository({ lock: '{ not json' }), { now: NOW })), ['lock-invalid']);
  assert.deepEqual(codes(checkRepo(repository({ lock: { digest: 'latest' } }), { now: NOW })), ['lock-invalid']);
  assert.deepEqual(codes(checkRepo(repository({ lock: { tag: 'ubuntu24-v1' } }), { now: NOW })), ['lock-invalid']);
  assert.deepEqual(codes(checkRepo(repository({ lock: { image: 'ghcr.io/other/image' } }), { now: NOW })), ['lock-invalid']);
});

test('a lock older than 21 days is a warning that tells how old it is, and a lock of 21 days is not', () => {
  const root = repository();
  const old = checkRepo(root, { now: new Date('2026-12-20T00:00:00Z') });
  assert.deepEqual(old.problems, []);
  assert.deepEqual(warningCodes(old), ['lock-old']);
  assert.match(old.warnings[0].message, /30 days/);
  assert.deepEqual(checkRepo(root, { now: new Date('2026-12-11T05:30:00Z') }).warnings, []);
});

test('NEGATIVE CONTROL: a kind or kubectl pin of the Pods workflow that the Dockerfile does not have fails, and a workflow that no longer pins them is fine', () => {
  const bumped = repository({ pods: PODS.replace('KIND_VERSION: v0.30.0', 'KIND_VERSION: v0.31.0') });
  const report = checkRepo(bumped, { now: NOW });
  assert.deepEqual(codes(report), ['tool-mirror-mismatch']);
  assert.match(report.problems[0].message, /v0\.31\.0/);
  assert.match(report.problems[0].message, /v0\.30\.0/);
  assert.deepEqual(codes(checkRepo(repository({ pods: PODS.replace(`KUBECTL_SHA256: ${KUBECTL_SHA}`, `KUBECTL_SHA256: ${'0'.repeat(64)}`) }), { now: NOW })), ['tool-mirror-mismatch']);
  assert.deepEqual(checkRepo(repository({ pods: 'name: pods\nenv:\n  NODE_VERSION: "26.13.0"\n' }), { now: NOW }).problems, []);
});

test('NEGATIVE CONTROL: a golangci-lint version of the lint step that the Dockerfile does not have fails, and a lint step that is gone, or another action\'s version, is fine', () => {
  const bumped = repository({ prChecks: `${workflow(`${IMAGE}@${DIGEST_A}`)}${lintStep('v2.16.0')}` });
  const report = checkRepo(bumped, { now: NOW });
  assert.deepEqual(codes(report), ['tool-mirror-mismatch']);
  assert.match(report.problems[0].message, /golangci-lint/);
  assert.match(report.problems[0].message, /v2\.16\.0/);
  assert.match(report.problems[0].message, /v2\.15\.0/);
  assert.deepEqual(checkRepo(repository({ prChecks: workflow(`${IMAGE}@${DIGEST_A}`) }), { now: NOW }).problems, [], 'no lint step, nothing to mirror');
});

test('an exact Go pin in a workflow that is not the image\'s is a warning, a floating one of the same series is not', () => {
  const different = checkRepo(repository({ pods: PODS.replace('GO_VERSION: "1.27.3"', 'GO_VERSION: "1.27.5"') }), { now: NOW });
  assert.deepEqual(different.problems, []);
  assert.deepEqual(warningCodes(different), ['go-pin-differs']);
  assert.match(different.warnings[0].message, /1\.27\.5/);
  assert.deepEqual(checkRepo(repository({ pods: PODS.replace('GO_VERSION: "1.27.3"', 'GO_VERSION: "1.27"') }), { now: NOW }).warnings, []);
});

// ---- the manifest of a running image ------------------------------------------------------------------------------------------------------------------------------------------

test('the manifest of an image built from this repository passes, and says how old it is', () => {
  const root = repository();
  assert.deepEqual(checkManifest(manifestFor(current(root)), root, { now: NOW }), { problems: [], warnings: [] });
});

test('NEGATIVE CONTROL: an image built from other inputs than the repository\'s is stale, and the report says to rebuild', () => {
  const root = repository({ lockfile: lockfile('1.65.0'), lockedFrom: { playwright: '1.64.1' } });
  const report = checkManifest(manifestFor({ ...current(root), playwright: '1.64.1' }), root, { now: NOW });
  assert.deepEqual(codes(report), ['image-behind', 'playwright-mismatch']);
  assert.match(report.problems.find((problem) => problem.code === 'image-behind').message, /rebuild/i);
});

test('NEGATIVE CONTROL: a toolchain of the image that is not the repository\'s trips its rule, and a Go above or below the series too', () => {
  const root = repository();
  const inputs = current(root);
  const tools = (over) => ({ tools: { ...manifestFor(inputs).tools, ...over } });
  assert.deepEqual(codes(checkManifest(manifestFor(inputs, tools({ node: '26.12.0' })), root, { now: NOW })), ['node-mismatch']);
  assert.deepEqual(codes(checkManifest(manifestFor(inputs, tools({ pnpm: '12.13.0' })), root, { now: NOW })), ['pnpm-mismatch']);
  assert.deepEqual(codes(checkManifest(manifestFor(inputs, tools({ go: '1.26.1' })), root, { now: NOW })), ['go-mismatch']);
});

test('a consumer\'s own pins are checked against the image: a prefix spec matches, another version is named', () => {
  const root = repository();
  const manifest = manifestFor(current(root));
  assert.deepEqual(checkManifest(manifest, root, { now: NOW, expect: { go: '1.27', node: '26.13.0', kind: '0.30.0', kubectl: 'v1.35' } }).problems, []);
  const report = checkManifest(manifest, root, { now: NOW, expect: { node: '26.14.0', go: '1.27.4' } });
  assert.deepEqual(codes(report), ['expectation-mismatch', 'expectation-mismatch']);
  assert.match(report.problems.map((problem) => problem.message).join('\n'), /26\.14\.0/);
  assert.deepEqual(codes(checkManifest(manifest, root, { now: NOW, expect: { nonesuch: '1' } })), ['expectation-mismatch']);
});

test('NEGATIVE CONTROL: a manifest without a browser or a tool is incomplete, not a pass', () => {
  const root = repository();
  const manifest = manifestFor(current(root));
  const noWebkit = { ...manifest, browsers: { ...manifest.browsers, webkit: undefined } };
  assert.deepEqual(codes(checkManifest(noWebkit, root, { now: NOW })), ['manifest-incomplete']);
  const noKind = { ...manifest, tools: { ...manifest.tools, kind: undefined } };
  assert.deepEqual(codes(checkManifest(noKind, root, { now: NOW })), ['manifest-incomplete']);
  assert.deepEqual(codes(checkManifest({ schema: 2 }, root, { now: NOW })), ['manifest-invalid']);
});

test('a manifest older than 21 days is a warning', () => {
  const root = repository();
  const report = checkManifest(manifestFor(current(root)), root, { now: new Date('2026-12-20T00:00:00Z') });
  assert.deepEqual(report.problems, []);
  assert.deepEqual(warningCodes(report), ['image-old']);
});

// ---- the lock a published image earns ------------------------------------------------------------------------------------------------------------------------------------------

test('writing the lock for a published image makes the repository pass, and moves every digest pin with it', () => {
  const root = repository({ lock: null, pr: workflow(`${IMAGE}@${DIGEST_B}`), prChecks: workflow(`${IMAGE}:ubuntu24-v1`) });
  const manifest = manifestFor(current(root));
  const written = writeLock(root, { digest: DIGEST_A, tag: TAG, manifest });
  assert.deepEqual(written.changed, ['.github/ci/image.lock', '.github/workflows/pr.yml']);
  assert.equal(written.lock.digest, DIGEST_A);
  assert.equal(written.lock.inputs.sha256, specHash(current(root)));
  assert.deepEqual(written.lock.manifest, manifest);
  assert.match(readFileSync(path.join(root, '.github/workflows/pr.yml'), 'utf8'), new RegExp(`${IMAGE}@${DIGEST_A}`));
  assert.match(readFileSync(path.join(root, '.github/workflows/pr-checks.yml'), 'utf8'), /omniview-ci:ubuntu24-v1/);
  const report = checkRepo(root, { now: NOW });
  assert.deepEqual(report.problems, []);
  assert.deepEqual(warningCodes(report), ['mutable-pin']);
  assert.equal(readFileSync(path.join(root, '.github/ci/image.lock'), 'utf8').endsWith('}\n'), true);
});

test('NEGATIVE CONTROL: no lock is written for an image that does not match the repository, and the workflows are left alone', () => {
  const root = repository({ lock: null });
  const before = readFileSync(path.join(root, '.github/workflows/pr.yml'), 'utf8');
  const manifest = manifestFor({ ...current(root), playwright: '1.63.0' });
  assert.throws(() => writeLock(root, { digest: DIGEST_B, tag: TAG, manifest }), /playwright/i);
  assert.equal(readFileSync(path.join(root, '.github/workflows/pr.yml'), 'utf8'), before);
  assert.throws(() => readFileSync(path.join(root, '.github/ci/image.lock'), 'utf8'), /ENOENT/);
});

test('NEGATIVE CONTROL: a digest or a tag that is not immutable is refused', () => {
  const root = repository({ lock: null });
  const manifest = manifestFor(current(root));
  assert.throws(() => writeLock(root, { digest: 'sha256:abc', tag: TAG, manifest }), /digest/);
  assert.throws(() => writeLock(root, { digest: DIGEST_A, tag: 'latest', manifest }), /tag/);
  assert.throws(() => writeLock(root, { digest: DIGEST_A, tag: 'ubuntu24-v1', manifest }), /tag/);
});

// ---- the command --------------------------------------------------------------------------------------------------------------------------------------------------------------

const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', ...env } });

test('the command passes on a right repository and prints the lock it checked', () => {
  const result = run(['check', '--root', repository(), '--now', NOW.toISOString()]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(TAG));
});

test('NEGATIVE CONTROL: the command fails with the code and the file on a drifted repository, and under GitHub Actions the line is an error annotation', () => {
  const root = repository({ lockfile: lockfile('1.65.0') });
  const plain = run(['check', '--root', root, '--now', NOW.toISOString()]);
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /playwright-mismatch/);
  assert.match(plain.stderr, /gh workflow run ci-image\.yml/);
  const annotated = run(['check', '--root', root, '--now', NOW.toISOString()], { GITHUB_ACTIONS: 'true' });
  assert.match(annotated.stderr, /^::error title=CI image \(playwright-mismatch\)::/m);
});

test('the command tells a workflow whether the image has to be rebuilt, through GITHUB_OUTPUT', () => {
  const output = path.join(mkdtempSync(path.join(tmpdir(), 'check-image-out-')), 'output');
  roots.push(path.dirname(output));
  assert.equal(run(['check', '--root', repository(), '--now', NOW.toISOString(), '--github-output', output]).status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'rebuild=false\nproblems=0\n');

  writeFileSync(output, '');
  assert.equal(run(['check', '--root', repository({ lockfile: lockfile('1.65.0') }), '--now', NOW.toISOString(), '--github-output', output]).status, 1);
  assert.equal(readFileSync(output, 'utf8'), 'rebuild=true\nproblems=2\n');

  writeFileSync(output, '');
  assert.equal(run(['check', '--root', repository({ prChecks: workflow(`${IMAGE}@${DIGEST_B}`) }), '--now', NOW.toISOString(), '--github-output', output]).status, 1);
  assert.equal(readFileSync(output, 'utf8'), 'rebuild=false\nproblems=2\n', 'a split of the pins is not cured by a rebuild');
});

test('the command checks the manifest of a running image against the repository and the consumer\'s own pins', () => {
  const root = repository();
  const file = path.join(root, 'manifest.json');
  writeFileSync(file, JSON.stringify(manifestFor(current(root))));
  const ok = run(['check', '--root', root, '--now', NOW.toISOString(), '--manifest', file, '--expect', 'go=1.27', '--expect', 'node=26.13.0']);
  assert.equal(ok.status, 0, ok.stderr);
  const stale = run(['check', '--root', root, '--now', NOW.toISOString(), '--manifest', file, '--expect', 'go=1.28']);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /expectation-mismatch/);
  const missing = run(['check', '--root', root, '--manifest', path.join(root, 'nope.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /manifest-invalid/);
});

test('the inputs are printed as build arguments for docker, and as JSON', () => {
  const root = repository();
  const docker = run(['inputs', '--root', root, '--format', 'docker-args']);
  assert.equal(docker.status, 0, docker.stderr);
  assert.deepEqual(docker.stdout.trim().split('\n'), [
    '--build-arg=NODE_VERSION=26.13.0',
    '--build-arg=PNPM_VERSION=12.14.0',
    '--build-arg=PLAYWRIGHT_VERSION=1.64.1',
    `--build-arg=DOCKERFILE_SHA256=${sha256(DOCKERFILE)}`,
    `--build-arg=INPUTS_SHA256=${specHash(current(root))}`,
  ]);
  const json = JSON.parse(run(['inputs', '--root', root]).stdout);
  assert.equal(json.sha256, specHash(current(root)));
  assert.equal(json.playwright, '1.64.1');
});

test('NEGATIVE CONTROL: the inputs of a repository that does not state them are not printed', () => {
  const result = run(['inputs', '--root', repository({ toolVersions: 'pnpm 12.14.0\n' }), '--format', 'docker-args']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /node-missing/);
});

test('write-lock writes the lock and the pins from a manifest, and refuses an image that does not match', () => {
  const root = repository({ lock: null, pr: workflow(`${IMAGE}@${DIGEST_B}`) });
  const file = path.join(root, 'manifest.json');
  writeFileSync(file, JSON.stringify(manifestFor(current(root))));
  const written = run(['write-lock', '--root', root, '--digest', DIGEST_A, '--tag', TAG, '--manifest', file]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /\.github\/ci\/image\.lock/);
  assert.match(written.stdout, /\.github\/workflows\/pr\.yml/);
  assert.equal(run(['check', '--root', root, '--now', NOW.toISOString()]).status, 0);

  const stale = repository({ lock: null });
  writeFileSync(path.join(stale, 'manifest.json'), JSON.stringify(manifestFor({ ...current(stale), node: '26.12.0' })));
  const refused = run(['write-lock', '--root', stale, '--digest', DIGEST_A, '--tag', TAG, '--manifest', path.join(stale, 'manifest.json')]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /node-mismatch/);
});

test('an unknown command or flag is a usage error, not a pass', () => {
  assert.equal(run(['frobnicate']).status, 2);
  assert.equal(run(['check', '--nonesuch']).status, 2);
  assert.match(run(['check', '--nonesuch']).stderr, /usage/);
});
