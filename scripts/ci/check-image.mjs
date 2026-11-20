// The staleness guard of the CI image (`ghcr.io/omniviewdev/omniview-ci`, built from .github/ci/Dockerfile by .github/workflows/ci-image.yml). It reads files and prints lines: no network, no
// Docker, no `node_modules`, so a job can run it in a second.
//
//   node scripts/ci/check-image.mjs [check] [--root <repository>] [--manifest <file>] [--expect <tool>=<version>]... [--require-digest-pins] [--github-output <file>] [--now <iso date>]
//   node scripts/ci/check-image.mjs inputs [--root <repository>] [--format json|docker-args]
//   node scripts/ci/check-image.mjs write-lock --digest sha256:<64 hex> --tag ubuntu24-<yyyymmdd>-<sha> --manifest <file> [--root <repository>]
//
// exit 0 when right, 1 with one line per problem, 2 for a command line it does not understand.
//
// What the image is built from, and who owns each version (one home each; a second copy is checked, never trusted):
//
//   Node        `.tool-versions`, the `nodejs` line             (its `golang` line is not read: it is not the Go the repository builds with)
//   pnpm        `package.json`, `packageManager`
//   Playwright  `pnpm-lock.yaml`: the one version that `playwright`, `playwright-core` and `@playwright/test` resolve to. The browsers in the image are those of this version, so two
//               versions in the lockfile cannot be served by one image and are a problem of their own.
//   Go          `go.mod`: the `go` directive (raised by a `toolchain` directive) is a floor. The image holds one exact patch of the same series, pinned in the Dockerfile (`ARG GO_VERSION`).
//   kind, kubectl  the Dockerfile's `ARG`s. The Pods workflow still pins the same two (and their sha256); until it takes them from the image the two copies must agree (MIRRORS below).
//   the Dockerfile itself, byte for byte.
//
// Those five make the INPUTS of the image and their hash (`inputsHash`). The lock (.github/ci/image.lock) records the hash an image was built from, its tag and digest, and the manifest the
// image reported about itself (/opt/ci/manifest.json: the tools it holds, observed, not echoed). Consumers pin the digest in `image:`.
//
// `check` (the repository against its lock), in the order of what a reader needs to know:
//
//   lock-missing, lock-invalid         there is nothing to pin: build and publish the image (see below).
//   inputs-behind                      an input changed since the image was built: the Dockerfile, Playwright, Node, pnpm or the Go floor. The image must be rebuilt.
//   playwright-mismatch, node-mismatch, pnpm-mismatch, go-mismatch   the image holds a tool that is not the repository's. Reported on their own, so that a bad build that kept the hash is caught.
//   manifest-incomplete                the manifest lacks a tool or a browser that every consumer relies on.
//   digest-split, digest-mismatch      the workflows pin two digests, or one that is not the lock's. Mutable tags (`omniview-ci:ubuntu24-v1`) are `mutable-pin` warnings until the consumers
//                                      move to the digest (`--require-digest-pins` makes them problems), and `lock-old` warns when the lock is older than 21 days.
//   tool-mirror-mismatch               kind or kubectl of the Pods workflow is not the Dockerfile's.
//
// `--manifest <file>` is what a consumer's first step runs inside its container (`--manifest /opt/ci/manifest.json`): the same questions about the image that is actually running, plus
// `image-behind` when it was built from other inputs than this checkout's. `--expect go=1.27` adds the job's own pins: a version is a prefix of dotted components.
//
// A rebuild is `gh workflow run ci-image.yml --ref <branch> -f publish=true`: the run builds, smokes and publishes an immutable tag, and uploads `image-lock.patch` (the lock and the
// digest pins that follow it). `write-lock` makes that patch; it refuses an image that does not match the repository.
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const IMAGE = 'ghcr.io/omniviewdev/omniview-ci';
export const DOCKERFILE = '.github/ci/Dockerfile';
export const LOCK = '.github/ci/image.lock';
export const MAX_AGE_DAYS = 21;

const WORKFLOWS = '.github/workflows';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TAG = /^ubuntu24-\d{8}-[0-9a-f]{7,40}$/;
const TOOLS = ['node', 'pnpm', 'playwright', 'go', 'task', 'goimports', 'golangci-lint', 'kind', 'kubectl'];
const BROWSERS = ['chromium', 'chromium-headless-shell', 'webkit'];
/** The problems a rebuild of the image cures. The others (a split of the pins, a pin that is not the lock's, a mirror) are cured in the repository. */
const REBUILD = new Set(['lock-missing', 'lock-invalid', 'inputs-behind', 'playwright-mismatch', 'node-mismatch', 'pnpm-mismatch', 'go-mismatch', 'manifest-incomplete', 'image-behind']);
/** Tools whose pin the Dockerfile and the Pods workflow both state: [Dockerfile ARG, workflow file, workflow key]. */
const MIRRORS = ['KIND_VERSION', 'KIND_SHA256', 'KUBECTL_VERSION', 'KUBECTL_SHA256'].map((key) => ({ arg: key, file: `${WORKFLOWS}/ui-next-pods.yml`, key }));
const REBUILD_HINT = 'rebuild with `gh workflow run ci-image.yml --ref <your branch> -f publish=true`, then apply the `image-lock.patch` artifact of that run (the lock and the digest pins) and commit it';

const problem = (code, message) => ({ code, message });
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const bare = (version) => String(version).replace(/^v/, '');

function read(root, file) {
  try {
    return readFileSync(path.join(root, file), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// ---- what the repository pins ------------------------------------------------------------------------------------------------------------------------------------------------

/** The Playwright version `pnpm-lock.yaml` resolves: the `packages:` keys of playwright, playwright-core and @playwright/test (peer-suffixed keys live in `snapshots:`). */
export function playwrightFromLockfile(text) {
  const byPackage = new Map();
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    if (line === '---') {
      section = null;
      continue;
    }
    const top = /^([A-Za-z]+):\s*$/.exec(line);
    if (top) {
      section = top[1];
      continue;
    }
    if (section !== 'packages') continue;
    const key = /^ {2}'?(@playwright\/test|playwright-core|playwright)@([^':\s]+)'?:/.exec(line);
    if (key) byPackage.set(key[1], [...(byPackage.get(key[1]) ?? []), key[2]]);
  }
  const versions = [...new Set([...byPackage.values()].flat())];
  if (versions.length === 0) {
    return { version: null, versions, problems: [problem('playwright-missing', 'pnpm-lock.yaml resolves no playwright, playwright-core or @playwright/test: the image cannot know which browsers to hold')] };
  }
  if (versions.length > 1) {
    const detail = [...byPackage].map(([name, list]) => `${name} ${list.join(', ')}`).join('; ');
    return { version: null, versions, problems: [problem('playwright-ambiguous', `pnpm-lock.yaml resolves Playwright to ${versions.length} versions (${detail}); the image holds the browsers of one: align them`)] };
  }
  return { version: versions[0], versions, problems: [] };
}

/** The tools of an asdf-style `.tool-versions`: `name version`, comments and blanks ignored. */
export function parseToolVersions(text) {
  const tools = {};
  for (const line of text.split(/\r?\n/)) {
    const [name, version] = line.replace(/#.*$/, '').trim().split(/\s+/);
    if (name && version) tools[name] = version;
  }
  return tools;
}

/** `pnpm@12.14.0` or `pnpm@12.14.0+sha512...` gives 12.14.0; another manager, or none, gives null. */
export function pnpmFromPackageJson(text) {
  try {
    const match = /^pnpm@(\d+\.\d+\.\d+[^+\s]*)/.exec(JSON.parse(text).packageManager ?? '');
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const parts = (version) => bare(version).split('.').map((part) => Number.parseInt(part, 10));
const compare = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/** The Go version go.mod asks for: the `go` directive, or the `toolchain` directive when that is higher. A missing patch is .0. */
export function goFloor(text) {
  const full = (version) => (/^\d+\.\d+$/.test(version) ? `${version}.0` : version);
  const go = /^go\s+(\d+\.\d+(?:\.\d+)?)\s*$/m.exec(text);
  if (!go) return null;
  const toolchain = /^toolchain\s+go(\d+\.\d+(?:\.\d+)?)\s*$/m.exec(text);
  const floor = full(go[1]);
  return toolchain && compare(full(toolchain[1]), floor) > 0 ? full(toolchain[1]) : floor;
}

/** The `ARG`s of a Dockerfile: the default, or null for a build argument that must be passed. */
export function dockerfileArgs(text) {
  const args = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/.exec(line.trim());
    if (!match) continue;
    const value = match[2] === undefined ? null : match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
    args[match[1]] = args[match[1]] ?? value;
  }
  return args;
}

/** `spec` is a prefix of the dotted components of `actual`: 1.27 matches 1.27.3, 1.27.4 does not. A leading `v` is not part of a version. */
export function versionMatches(actual, spec) {
  const [have, want] = [bare(actual).split('.'), bare(spec).split('.')];
  return want.length <= have.length && want.every((part, index) => part === have[index]);
}

/** Go `actual` can stand for a go.mod that asks for `floor`: the same series, and a patch at or above it. */
export function satisfiesGoFloor(actual, floor) {
  const [a, f] = [parts(actual), parts(floor)];
  return a.length >= 2 && f.length >= 2 && a[0] === f[0] && a[1] === f[1] && (a[2] ?? 0) >= (f[2] ?? 0);
}

// ---- the inputs of the image -------------------------------------------------------------------------------------------------------------------------------------------------

/** The inputs of the image as this checkout states them. `problems` says which input is missing or ambiguous; its value is then null. */
export function resolveInputs(root) {
  const problems = [];
  const dockerfile = (() => {
    try {
      return readFileSync(path.join(root, DOCKERFILE));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  })();
  if (dockerfile === null) problems.push(problem('dockerfile-missing', `${DOCKERFILE} is missing`));

  const toolVersions = read(root, '.tool-versions');
  const node = toolVersions === null ? null : (parseToolVersions(toolVersions).nodejs ?? null);
  if (node === null) problems.push(problem('node-missing', 'Node is pinned by the `nodejs` line of .tool-versions and it is not there: the image cannot know which Node to hold'));

  const packageJson = read(root, 'package.json');
  const pnpm = packageJson === null ? null : pnpmFromPackageJson(packageJson);
  if (pnpm === null) problems.push(problem('pnpm-missing', 'pnpm is pinned by `packageManager` in package.json (`pnpm@<version>`) and it is not there: the image cannot know which pnpm to hold'));

  const lockfile = read(root, 'pnpm-lock.yaml');
  const playwright = lockfile === null ? { version: null, problems: [problem('playwright-missing', 'pnpm-lock.yaml is missing: the image cannot know which Playwright to hold')] } : playwrightFromLockfile(lockfile);
  problems.push(...playwright.problems);

  const goMod = read(root, 'go.mod');
  const floor = goMod === null ? null : goFloor(goMod);
  if (floor === null) problems.push(problem('go-missing', 'Go is pinned by the `go` directive of go.mod and it is not there: the image cannot know which Go to hold'));

  return {
    inputs: { schema: 1, dockerfile_sha256: dockerfile === null ? null : sha256(dockerfile), node, pnpm, playwright: playwright.version, go_floor: floor },
    problems,
  };
}

/** The hash an image is built from: the definition is fixed here, and restated by the test. */
export function inputsHash(inputs) {
  const { schema, dockerfile_sha256: dockerfile, node, pnpm, playwright, go_floor: goFloorVersion } = inputs;
  return sha256(JSON.stringify({ schema, dockerfile_sha256: dockerfile, node, pnpm, playwright, go_floor: goFloorVersion }));
}

const INPUT_NAMES = { dockerfile_sha256: 'the Dockerfile', node: 'Node', pnpm: 'pnpm', playwright: 'Playwright', go_floor: 'the Go floor of go.mod' };

function whatChanged(locked, now) {
  const changes = [];
  for (const [field, name] of Object.entries(INPUT_NAMES)) {
    if (locked[field] === now[field]) continue;
    changes.push(field === 'dockerfile_sha256' ? `${name} changed` : `${name} ${locked[field]} -> ${now[field]}`);
  }
  return changes.length > 0 ? changes.join(', ') : 'its recorded hash is not the hash of its own inputs';
}

// ---- the pins in the workflows -------------------------------------------------------------------------------------------------------------------------------------------------

function workflowFiles(root) {
  try {
    return readdirSync(path.join(root, WORKFLOWS)).filter((name) => /\.ya?ml$/.test(name)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const REFERENCE = /ghcr\.io\/omniviewdev\/omniview-ci(?![A-Za-z0-9_-])(?::([A-Za-z0-9_][A-Za-z0-9_.-]*))?(?:@(sha256:[0-9a-f]{64}))?/g;

/** Every reference to the image in a workflow that names a tag or a digest. A bare name, and anything after a `#`, is not a pin. */
export function scanPins(root) {
  const pins = [];
  for (const name of workflowFiles(root)) {
    const file = `${WORKFLOWS}/${name}`;
    (read(root, file) ?? '').split(/\r?\n/).forEach((text, index) => {
      for (const match of text.replace(/(^|\s)#.*$/, '').matchAll(REFERENCE)) {
        if (match[1] === undefined && match[2] === undefined) continue;
        pins.push({ file, line: index + 1, ...(match[1] === undefined ? {} : { tag: match[1] }), ...(match[2] === undefined ? {} : { digest: match[2] }) });
      }
    });
  }
  return pins;
}

/** `digest` is what the lock says; a digest pin that is not it is rewritten. Tag pins and bare names are left alone. Returns the files that changed. */
function rewriteDigestPins(root, digest) {
  const changed = [];
  for (const name of workflowFiles(root)) {
    const file = `${WORKFLOWS}/${name}`;
    const text = read(root, file) ?? '';
    const next = text.replace(/(ghcr\.io\/omniviewdev\/omniview-ci(?![A-Za-z0-9_-])(?::[A-Za-z0-9_][A-Za-z0-9_.-]*)?@)sha256:[0-9a-f]{64}/g, `$1${digest}`);
    if (next !== text) {
      writeFileSync(path.join(root, file), next);
      changed.push(file);
    }
  }
  return changed;
}

// ---- the lock and the manifest -------------------------------------------------------------------------------------------------------------------------------------------------

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function readLock(root) {
  const text = read(root, LOCK);
  if (text === null) return { lock: null, problems: [problem('lock-missing', `${LOCK} is missing, so there is no image to pin: ${REBUILD_HINT}`)] };
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (error) {
    return { lock: null, problems: [problem('lock-invalid', `${LOCK} is not JSON (${error.message}): ${REBUILD_HINT}`)] };
  }
  const faults = [];
  if (!isObject(lock)) faults.push('it is not an object');
  else {
    if (lock.schema !== 1) faults.push(`schema is ${JSON.stringify(lock.schema)}, not 1`);
    if (lock.image !== IMAGE) faults.push(`image is ${JSON.stringify(lock.image)}, not ${IMAGE}`);
    if (!TAG.test(lock.tag ?? '')) faults.push(`tag ${JSON.stringify(lock.tag)} is not an immutable tag (ubuntu24-<yyyymmdd>-<git sha>)`);
    if (!DIGEST.test(lock.digest ?? '')) faults.push(`digest ${JSON.stringify(lock.digest)} is not a sha256 digest`);
    if (!isObject(lock.inputs) || typeof lock.inputs.sha256 !== 'string') faults.push('inputs.sha256 is missing');
    if (!isObject(lock.manifest) || !isObject(lock.manifest.tools)) faults.push('manifest.tools is missing');
    else if (isObject(lock.inputs) && lock.manifest.inputs_sha256 !== lock.inputs.sha256) faults.push('the manifest was not built from the inputs the lock records');
  }
  return faults.length > 0 ? { lock: null, problems: [problem('lock-invalid', `${LOCK} is not a lock: ${faults.join('; ')}. ${REBUILD_HINT}`)] } : { lock, problems: [] };
}

/** What the tools and browsers a manifest lists say about the repository's pins. `source` names the manifest in the messages. */
function compareManifest(manifest, inputs, source) {
  const problems = [];
  const tools = isObject(manifest.tools) ? manifest.tools : {};
  const browsers = isObject(manifest.browsers) ? manifest.browsers : {};
  const lacking = [
    ...TOOLS.filter((name) => typeof tools[name] !== 'string' || tools[name] === '').map((name) => `tool ${name}`),
    ...BROWSERS.filter((name) => !isObject(browsers[name]) || !browsers[name].revision).map((name) => `browser ${name}`),
  ];
  if (lacking.length > 0) problems.push(problem('manifest-incomplete', `${source} does not list ${lacking.join(', ')}: every consumer relies on them, so this image cannot serve them. ${REBUILD_HINT}`));
  if (typeof tools.playwright === 'string' && inputs.playwright && tools.playwright !== inputs.playwright) {
    problems.push(problem('playwright-mismatch', `${source} holds Playwright ${tools.playwright}, pnpm-lock.yaml resolves ${inputs.playwright}: the browsers of the image are not the ones the repository's Playwright launches`));
  }
  if (typeof tools.node === 'string' && inputs.node && tools.node !== inputs.node) {
    problems.push(problem('node-mismatch', `${source} holds Node ${tools.node}, .tool-versions pins ${inputs.node}`));
  }
  if (typeof tools.pnpm === 'string' && inputs.pnpm && tools.pnpm !== inputs.pnpm) {
    problems.push(problem('pnpm-mismatch', `${source} holds pnpm ${tools.pnpm}, package.json pins ${inputs.pnpm}`));
  }
  if (typeof tools.go === 'string' && inputs.go_floor && !satisfiesGoFloor(tools.go, inputs.go_floor)) {
    problems.push(problem('go-mismatch', `${source} holds Go ${tools.go}, go.mod asks for ${inputs.go_floor}: the image must hold the same series (${inputs.go_floor.split('.').slice(0, 2).join('.')}) at that patch or above`));
  }
  return problems;
}

function age(builtAt, now, code, what) {
  const built = Date.parse(builtAt ?? '');
  if (Number.isNaN(built)) return [];
  const days = (now.getTime() - built) / 86_400_000;
  return days > MAX_AGE_DAYS ? [problem(code, `${what} was built ${Math.ceil(days)} days ago (more than ${MAX_AGE_DAYS}): the weekly rebuild did not reach main. ${REBUILD_HINT}`)] : [];
}

function workflowValue(root, file, key) {
  const match = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\s#]+)`, 'm').exec(read(root, file) ?? '');
  return match ? match[1] : null;
}

// ---- the checks --------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The repository against its lock: `{ problems, warnings }`, each `{ code, message }`. */
export function checkRepo(root, { now = new Date(), requireDigestPins = false } = {}) {
  const problems = [];
  const warnings = [];
  const { inputs, problems: inputProblems } = resolveInputs(root);
  problems.push(...inputProblems);
  const { lock, problems: lockProblems } = readLock(root);
  problems.push(...lockProblems);

  const pins = scanPins(root);
  const digestPins = pins.filter((pin) => pin.digest !== undefined);
  const distinct = [...new Set(digestPins.map((pin) => pin.digest))];
  if (distinct.length > 1) {
    problems.push(problem('digest-split', `the workflows pin ${distinct.length} different digests of the CI image: ${distinct.map((digest) => `${digest} (${digestPins.filter((pin) => pin.digest === digest).map((pin) => `${pin.file}:${pin.line}`).join(', ')})`).join('; ')}`));
  }
  if (lock) {
    for (const pin of digestPins) {
      if (pin.digest !== lock.digest) problems.push(problem('digest-mismatch', `${pin.file}:${pin.line} pins ${pin.digest} and ${LOCK} says ${lock.digest} (${lock.tag}): pin the lock's digest`));
    }
  }
  for (const pin of pins.filter((candidate) => candidate.digest === undefined)) {
    const text = `${pin.file}:${pin.line} pulls the mutable tag ${IMAGE}:${pin.tag}: it can change under the job; pin the digest in ${LOCK}`;
    (requireDigestPins ? problems : warnings).push(problem('mutable-pin', text));
  }

  if (lock) {
    if (inputProblems.length === 0 && lock.inputs.sha256 !== inputsHash(inputs)) {
      problems.push(problem('inputs-behind', `CI image is stale: ${LOCK} was built from other inputs than this checkout's (${whatChanged(lock.inputs, inputs)}): ${REBUILD_HINT}`));
    }
    problems.push(...compareManifest(lock.manifest, inputs, `the locked image ${lock.tag}`));
    warnings.push(...age(lock.manifest.built_at, now, 'lock-old', `the locked image ${lock.tag}`));
  }

  const dockerfile = read(root, DOCKERFILE);
  const args = dockerfile === null ? {} : dockerfileArgs(dockerfile);
  for (const { arg, file, key } of MIRRORS) {
    const theirs = workflowValue(root, file, key);
    if (theirs !== null && theirs !== args[arg]) {
      problems.push(problem('tool-mirror-mismatch', `${file} pins ${key} ${theirs} and the Dockerfile's ARG ${arg} is ${args[arg] ?? 'not set'}: change both (and rebuild the image), or drop the workflow's pin once the job takes the tool from the image`));
    }
  }
  if (args.GO_VERSION) {
    for (const name of workflowFiles(root)) {
      const file = `${WORKFLOWS}/${name}`;
      (read(root, file) ?? '').split(/\r?\n/).forEach((text, index) => {
        const exact = /(?:go-version|GO_VERSION):\s*["']?(\d+\.\d+\.\d+)["']?\s*(?:#.*)?$/.exec(text);
        if (exact && exact[1] !== args.GO_VERSION) {
          warnings.push(problem('go-pin-differs', `${file}:${index + 1} pins Go ${exact[1]} and the image holds ${args.GO_VERSION}: one Go for every job is the aim (the image's is ARG GO_VERSION)`));
        }
      });
    }
  }
  return { problems, warnings, inputs, lock };
}

/** The manifest of a running image (what `cat /opt/ci/manifest.json` prints in the container) against this checkout, and against the pins `expect` gives (`{ tool: version }`). */
export function checkManifest(manifest, root, { now = new Date(), expect = {} } = {}) {
  if (!isObject(manifest) || manifest.schema !== 1 || !isObject(manifest.tools)) {
    return { problems: [problem('manifest-invalid', 'the image manifest is not a schema 1 manifest with a `tools` table: the image was not built by .github/ci/Dockerfile')], warnings: [] };
  }
  const { inputs, problems: inputProblems } = resolveInputs(root);
  const problems = [...inputProblems, ...compareManifest(manifest, inputs, 'the image')];
  if (inputProblems.length === 0 && manifest.inputs_sha256 !== inputsHash(inputs)) {
    problems.push(problem('image-behind', `CI image is stale: it was built from other inputs than this checkout's (hash ${String(manifest.inputs_sha256).slice(0, 12)}, this checkout ${inputsHash(inputs).slice(0, 12)}): ${REBUILD_HINT}`));
  }
  for (const [tool, spec] of Object.entries(expect)) {
    const actual = manifest.tools[tool];
    if (typeof actual !== 'string' || !versionMatches(actual, spec)) {
      problems.push(problem('expectation-mismatch', `this job expects ${tool} ${spec} and the image holds ${typeof actual === 'string' ? actual : 'no such tool'}`));
    }
  }
  return { problems, warnings: age(manifest.built_at, now, 'image-old', 'the image') };
}

/**
 * The lock for a published image, and the digest pins that follow it. The image's manifest must match the repository, or nothing is written. Returns the lock and the files changed.
 */
export function writeLock(root, { digest, tag, manifest, now = new Date() }) {
  if (!DIGEST.test(digest ?? '')) throw new Error(`the digest ${JSON.stringify(digest)} is not a sha256 digest (sha256:<64 hex>)`);
  if (!TAG.test(tag ?? '')) throw new Error(`the tag ${JSON.stringify(tag)} is not an immutable tag (ubuntu24-<yyyymmdd>-<git sha>)`);
  const { problems } = checkManifest(manifest, root, { now });
  if (problems.length > 0) throw new Error(`the image does not match this checkout, no lock written:\n${problems.map((entry) => `[${entry.code}] ${entry.message}`).join('\n')}`);
  const { inputs } = resolveInputs(root);
  const lock = { schema: 1, image: IMAGE, tag, digest, inputs: { ...inputs, sha256: inputsHash(inputs) }, manifest };
  writeFileSync(path.join(root, LOCK), `${JSON.stringify(lock, null, 2)}\n`);
  return { lock, changed: [LOCK, ...rewriteDigestPins(root, digest)] };
}

// ---- the command -------------------------------------------------------------------------------------------------------------------------------------------------------------

const USAGE = `usage: node scripts/ci/check-image.mjs [check] [--root <repository>] [--manifest <file>] [--expect <tool>=<version>]... [--require-digest-pins] [--github-output <file>] [--now <iso date>]
       node scripts/ci/check-image.mjs inputs [--root <repository>] [--format json|docker-args]
       node scripts/ci/check-image.mjs write-lock --digest sha256:<digest> --tag <tag> --manifest <file> [--root <repository>]`;

function report({ problems, warnings }, github) {
  const escape = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  const lines = (list, level) => list.map(({ code, message }) => (github ? `::${level} title=CI image (${code})::${escape(message)}` : `check-image: ${level === 'error' ? '' : 'warning '}[${code}] ${message}`));
  for (const line of lines(warnings, 'warning')) console.error(line);
  for (const line of lines(problems, 'error')) console.error(line);
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0] !== undefined && !argv[0].startsWith('-') ? argv[0] : 'check';
  const rest = command === argv[0] ? argv.slice(1) : argv;
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      allowPositionals: false,
      options: {
        root: { type: 'string' },
        manifest: { type: 'string' },
        expect: { type: 'string', multiple: true },
        'require-digest-pins': { type: 'boolean' },
        'github-output': { type: 'string' },
        now: { type: 'string' },
        format: { type: 'string' },
        digest: { type: 'string' },
        tag: { type: 'string' },
      },
    }));
  } catch (error) {
    console.error(`check-image: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (!['check', 'inputs', 'write-lock'].includes(command)) {
    console.error(`check-image: unknown command ${command}\n${USAGE}`);
    return 2;
  }
  const root = path.resolve(values.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const now = values.now === undefined ? new Date() : new Date(values.now);
  const github = env.GITHUB_ACTIONS === 'true';

  try {
    if (command === 'inputs') return printInputs(root, values.format ?? 'json', github);
    if (command === 'write-lock') return runWriteLock(root, values, now);

    const expect = {};
    for (const entry of values.expect ?? []) {
      const [tool, ...version] = entry.split('=');
      if (!tool || version.length === 0) {
        console.error(`check-image: --expect wants <tool>=<version>, not ${JSON.stringify(entry)}\n${USAGE}`);
        return 2;
      }
      expect[tool] = version.join('=');
    }
    if (values.manifest !== undefined) return checkRunningImage(root, values.manifest, { now, expect, github });

    const result = checkRepo(root, { now, requireDigestPins: values['require-digest-pins'] === true });
    report(result, github);
    if (values['github-output'] !== undefined) {
      appendFileSync(values['github-output'], `rebuild=${result.problems.some((entry) => REBUILD.has(entry.code))}\nproblems=${result.problems.length}\n`);
    }
    if (result.problems.length > 0) return 1;
    const { lock, inputs } = result;
    console.log(`check-image: ok: ${lock.tag} (${lock.digest}) was built from this checkout's inputs: Playwright ${inputs.playwright}, Node ${inputs.node}, pnpm ${inputs.pnpm}, Go ${lock.manifest.tools.go} for go.mod ${inputs.go_floor}; built ${lock.manifest.built_at}`);
    return 0;
  } catch (error) {
    console.error(`check-image: ${error.message}`);
    return 1;
  }
}

function printInputs(root, format, github) {
  if (!['json', 'docker-args'].includes(format)) {
    console.error(`check-image: --format is json or docker-args, not ${format}\n${USAGE}`);
    return 2;
  }
  const { inputs, problems } = resolveInputs(root);
  if (problems.length > 0) {
    report({ problems, warnings: [] }, github);
    return 1;
  }
  const hash = inputsHash(inputs);
  if (format === 'json') {
    console.log(JSON.stringify({ ...inputs, sha256: hash }, null, 2));
    return 0;
  }
  const args = { NODE_VERSION: inputs.node, PNPM_VERSION: inputs.pnpm, PLAYWRIGHT_VERSION: inputs.playwright, DOCKERFILE_SHA256: inputs.dockerfile_sha256, INPUTS_SHA256: hash };
  for (const [name, value] of Object.entries(args)) console.log(`--build-arg=${name}=${value}`);
  return 0;
}

function runWriteLock(root, values, now) {
  if (values.digest === undefined || values.tag === undefined || values.manifest === undefined) {
    console.error(`check-image: write-lock needs --digest, --tag and --manifest\n${USAGE}`);
    return 2;
  }
  const { changed } = writeLock(root, { digest: values.digest, tag: values.tag, manifest: JSON.parse(readFileSync(values.manifest, 'utf8')), now });
  for (const file of changed) console.log(file);
  return 0;
}

function checkRunningImage(root, file, { now, expect, github }) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    report({ problems: [problem('manifest-invalid', `cannot read the image manifest ${file}: ${error.message}. Is this job running in the CI image?`)], warnings: [] }, github);
    return 1;
  }
  const result = checkManifest(manifest, root, { now, expect });
  report(result, github);
  if (result.problems.length > 0) return 1;
  const tools = Object.entries(manifest.tools).map(([name, version]) => `${name} ${version}`).join(', ');
  console.log(`check-image: ok: the image built ${manifest.built_at} matches this checkout: ${tools}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
