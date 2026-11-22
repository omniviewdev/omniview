// Which parts of the repository a pull request changes, and so which CI jobs can have an answer (N24 step D1; docs/ui-next/status/N24-D1.md has the proof, job by job).
//
//   node scripts/ci/changes.mjs [--root <repository>] [--base <ref>] [--head <ref>]
//
// It lists the paths the change touches (`git diff --name-only` between <base> and <head>, default `HEAD^1` and `HEAD`: the base of the merge commit a pull request is checked out as, and
// that commit), puts each in an area, and decides a class for the whole change:
//
//   docs    every path is documentation: README.md, Markdown under docs/, anything under docs/ui-next/status/ (the proof-tool copies, YAML, JSON, images: evidence that nothing reads, see below). The host jobs, the
//           Windows build and the UI jobs are skipped; the repository guard is not.
//   new-ui  every path is the new UI (ui-next/, packages/kit/), its documentation (docs/ui-next/) or its own tooling (NEW_UI_TOOLING below). The stable build, the Go host and the e2e suite never
//           read them, so the host jobs are skipped; the UI jobs, the Windows build (it runs the kit's build and generate scripts on a shipping platform), the kit probes and the Pods cluster check are not.
//   all     anything else, and a change with no path: every job runs. A path the script has never seen is "other", and "other" is absorbing.
//
// The workflows read three flags, `skip_host`, `skip_ui` and `skip_windows`, as `needs.changes.outputs.skip_host != 'true'`: a classifier that wrote nothing skips nothing. On a runner the command also writes
// one `::notice title=Changed paths::class=<class> skip_host=<bool> skip_ui=<bool> skip_windows=<bool>`, which the check run keeps as an annotation: the merge gate reads the class there. The jobs are listed in
// GATED, the jobs that always run in ALWAYS, and scripts/ci/changes-workflows.test.mjs holds both workflows to the two lists. A new job goes in one of them, or that test fails.
//
// WHAT "CANNOT BE REACHED" MEANS. The host jobs (Go checks, Go lint, Windows connection profiles, Bindings freshness, Release packaging contracts, the macOS and Linux build-artifacts, the e2e suite) build
// the stable frontend from `index.html` and `ui/` (vite.config.ts: OMNIVIEW_UI unset is `current`), the Go module, the Wails bindings and the plugin UIs from the runtime, providers and
// vite-plugin packages. No file of those imports ui-next/ or the kit, no `go:embed` or Go test opens one, and no `.go` file lives in them; docs/ is read by nothing but the Pods workflow (its
// fixture, which is not prose). When a path might be read, it is not in a class: add it here only with the search that shows nothing reads it.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const CLASSES = ['docs', 'new-ui', 'all'];

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// Documentation is the e2e selector's prose (e2e/scripts/select-tests.mjs: `isProse`, README.md and Markdown under docs/) and everything under docs/ui-next/status/. Nothing reads a path there: the mentions outside docs/ are
// comments, Markdown, messages and the selector's own classification, and changes.test.mjs searches again on every pull request and fails when one starts to. Anything else under docs/ (`.mdx`, `.yaml`, `.json`, `.png`,
// `.sh`, `.zip`) stays out: a fixture, a recipe or a bench input can be read. Markdown outside docs/ stays out too: the API reports, the vocabulary guard's scan, changesets and skills read it.
const DOCS_MARKDOWN = /^docs\/(?:[^/]+\/)*[^/]+\.md$/;
const STATUS_EVIDENCE = /^docs\/ui-next\/status\//;

/** The new UI and its documentation. */
const NEW_UI_ROOTS = ['ui-next/', 'packages/kit/', 'docs/ui-next/'];

// The new UI's own tooling: files that only a check which stays for a change to the new UI reads, or that no workflow reads at all (docs/ui-next/status/N24-D1.md has the search for each).
// A new probe or control is a unit file of the probe table, so every pull request that adds one changes it: it must not turn a change to the new UI into a change to everything.
//   scripts/ci/probe-units/                             the probe table, one file for each probe (N25): the kit probes workflow (the plan and every shard) is the only reader
//   scripts/ci/probe-shards.mjs, probe-shards.test.mjs  the engine of the table (the same workflow is the only reader), and since N25 its selection and packing, their tests and their data:
//   scripts/ci/probe-select.*, probe-pack.*, probe-shards.runs.json
//   scripts/ci/probe-shards.mjs imports ./changes.mjs (the classifier below) and nothing else of scripts/ci reads the files above
//   scripts/ui-next-pods/                               the Pods cluster check is the only reader
//   scripts/ui-next-bundle.mjs                          scripts/ui-flavour.test.mjs, in the UI build job
//   bench/table/, bench/log/                            the kit's benches: no workflow runs them (the UI lint job lints them)
const NEW_UI_TOOLING_ROOTS = ['scripts/ci/probe-units/', 'scripts/ui-next-pods/', 'bench/table/', 'bench/log/'];
const NEW_UI_TOOLING_FILES = new Set([
  'scripts/ci/probe-shards.mjs',
  'scripts/ci/probe-shards.test.mjs',
  'scripts/ci/probe-shards.runs.json',
  'scripts/ci/probe-select.mjs',
  'scripts/ci/probe-select.test.mjs',
  'scripts/ci/probe-select.prs.json',
  'scripts/ci/probe-pack.mjs',
  'scripts/ci/probe-pack.test.mjs',
  'scripts/ui-next-bundle.mjs',
]);

// What a host job executes from the new trees, and so is NOT the new UI: vite.config.ts names `./ui-next/test-setup.ts` among the root vitest configuration's `setupFiles` (vite.config.ts:55), and
// the e2e runner runs `vitest run ui/features/plugins/adapters/clearPlugin.test.ts` with that configuration in every run that is not cache-only (e2e/scripts/cohort.mjs:74, run.mjs:229).
// The file imports nothing (changes.test.mjs fails if it starts to, and if vite.config.ts names another file of the new trees), so the path is all there is to carve out.
const LOADED_BY_THE_HOST = new Set(['ui-next/test-setup.ts']);

// What the Go jobs read wherever it sits: Go sources and modules, and the C family a cgo package compiles. There is none under the new UI today; if one appears, the Go jobs run.
const GO_INPUT = /(?:^|\/)(?:go\.(?:mod|sum|work|work\.sum)|[^/]*\.(?:go|c|cc|cpp|cxx|h|hh|hpp|m|mm|s|S|syso))$/;

/** A plain repository-relative path: no control character (a newline in a name must not be able to write a line of a log), no backslash, no empty, `.` or `..` segment. */
const isPlain = (file) => !/[\u0000-\u001f\u007f\\]/.test(file) && !file.startsWith('/') && !file.endsWith('/') && file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

/** `docs`, `new-ui` or `other`. A path that is not known to be the first two is `other`, which runs everything. */
export function pathArea(file) {
  if (typeof file !== 'string' || file === '' || !isPlain(file)) return 'other';
  if (file === 'README.md' || DOCS_MARKDOWN.test(file) || (STATUS_EVIDENCE.test(file) && !GO_INPUT.test(file))) return 'docs';
  if (!LOADED_BY_THE_HOST.has(file) && (NEW_UI_ROOTS.some((root) => file.startsWith(root)) || NEW_UI_TOOLING_ROOTS.some((root) => file.startsWith(root)) || NEW_UI_TOOLING_FILES.has(file)) && !GO_INPUT.test(file)) return 'new-ui';
  return 'other';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The class of a change: `{ class, skipHost, skipUi, counts, deciding, reason }`. `counts` is by area, over the distinct paths; `deciding` is the distinct `other` paths in the order they came,
 * the paths that made it `all`.
 */
export function classify(paths) {
  if (!Array.isArray(paths)) throw new TypeError('classify needs the array of changed paths');
  const counts = { docs: 0, 'new-ui': 0, other: 0 };
  const deciding = [];
  for (const file of new Set(paths)) {
    const area = pathArea(file);
    counts[area] += 1;
    if (area === 'other') deciding.push(String(file));
  }
  let klass = 'all';
  let reason = 'a changed path is not documentation or the new UI: nothing can be skipped';
  if (counts.docs + counts['new-ui'] + counts.other === 0) {
    reason = 'no changed path: nothing proves that a job can be skipped';
  } else if (counts.other === 0 && counts['new-ui'] === 0) {
    klass = 'docs';
    reason = 'every changed path is documentation that nothing builds, tests or reads';
  } else if (counts.other === 0) {
    klass = 'new-ui';
    reason = 'every changed path is the new UI or its documentation, which the host jobs never read';
  }
  return { class: klass, skipHost: klass !== 'all', skipUi: klass === 'docs', skipWindows: klass === 'docs', counts, deciding, reason };
}

/** What the workflows read: the class, and the two flags as the strings `true` and `false`. */
export function outputsOf(result) {
  return { class: result.class, skip_host: String(result.skipHost), skip_ui: String(result.skipUi), skip_windows: String(result.skipWindows) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The jobs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export const WORKFLOW_NAMES = { 'pr.yml': 'PR Validation', 'pr-checks.yml': 'PR Checks' };

/**
 * The jobs a flag skips: `host` is the Go host and what builds or runs it, `ui` the UI jobs, `windows` the Windows build (a change to the new UI keeps it: it builds the kit and runs its scripts on a shipping platform; only
 * documentation skips it). `check` is the name the job's check has (a matrix job has one check per entry; a call of a reusable workflow has its id). Each is `needs: changes` with `if: needs.changes.outputs.skip_<flag> != 'true'`.
 */
export const GATED = [
  { flag: 'host', workflow: 'pr-checks.yml', job: 'release-packaging-checks', check: 'Release packaging contracts' },
  { flag: 'host', workflow: 'pr-checks.yml', job: 'windows-connection-profiles', check: 'Windows connection profiles' },
  { flag: 'host', workflow: 'pr-checks.yml', job: 'go-checks', check: 'Go checks' },
  { flag: 'host', workflow: 'pr-checks.yml', job: 'go-lint', check: 'Go lint' },
  { flag: 'host', workflow: 'pr-checks.yml', job: 'bindings-check', check: 'Bindings freshness' },
  { flag: 'host', workflow: 'pr.yml', job: 'e2e-application', check: 'e2e-application' },
  { flag: 'host', workflow: 'pr.yml', job: 'build-artifacts', check: 'build-artifacts' },
  { flag: 'windows', workflow: 'pr.yml', job: 'build-artifacts-windows', check: 'build-artifacts (windows/amd64)' },
  { flag: 'ui', workflow: 'pr-checks.yml', job: 'c02-corpus', check: 'C02 error transport corpus' },
  { flag: 'ui', workflow: 'pr-checks.yml', job: 'ui-build', check: 'UI build' },
  { flag: 'ui', workflow: 'pr-checks.yml', job: 'ui-lint', check: 'UI lint and kit contracts' },
  { flag: 'ui', workflow: 'pr-checks.yml', job: 'ui-component-tests', check: 'UI component tests' },
  { flag: 'ui', workflow: 'pr-checks.yml', job: 'ui-runtime-contract', check: 'UI runtime contract' },
];

/**
 * The jobs that run on every pull request: the classifier (one in each workflow), the repository guard, and the two gates, which are green when their parts were skipped by path and red in
 * every other case.
 */
export const ALWAYS = [
  { workflow: 'pr-checks.yml', job: 'changes' },
  { workflow: 'pr-checks.yml', job: 'repo-guard' },
  { workflow: 'pr-checks.yml', job: 'ui-checks' },
  { workflow: 'pr.yml', job: 'changes' },
  { workflow: 'pr.yml', job: 'e2e-tests' },
];

/** The gated jobs a change skips, in the order of the table. */
export function skippedBy(result) {
  return GATED.filter((entry) => result[{ host: 'skipHost', ui: 'skipUi', windows: 'skipWindows' }[entry.flag]]);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const SHOWN = 10;

/** A path as one line of a log or a Markdown code span: nothing in it can end the line, start a workflow command or end the span. */
const show = (file) => {
  const clean = String(file).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '?').replaceAll('`', "'");
  return clean.length > 200 ? `${clean.slice(0, 200)}...` : clean;
};

function countsLine(result) {
  const { counts } = result;
  const total = counts.docs + counts['new-ui'] + counts.other;
  return `${total} changed path${total === 1 ? '' : 's'}: ${counts.docs} documentation, ${counts['new-ui']} new UI, ${counts.other} elsewhere.`;
}

/** The job summary (Markdown): the class, the counts, and what was skipped by path, or the paths that made everything run. */
export function renderSummary(result) {
  const lines = [`### Changed paths: \`${result.class}\``, '', countsLine(result), ''];
  if (result.class === 'all') {
    lines.push(`Everything runs: ${result.reason}.`);
    if (result.deciding.length > 0) {
      lines.push('', 'These paths decided it:');
      for (const file of result.deciding.slice(0, SHOWN)) lines.push(`- \`${show(file)}\``);
      if (result.deciding.length > SHOWN) lines.push(`- (${result.deciding.length - SHOWN} more)`);
    }
  } else {
    lines.push(`This change is ${result.class === 'docs' ? 'documentation only' : 'the new UI and its documentation only'}: ${result.reason}.`, '');
    lines.push(`| Check skipped by path: ${result.class} | Workflow |`, '|---|---|');
    for (const entry of skippedBy(result)) lines.push(`| ${entry.check} | ${WORKFLOW_NAMES[entry.workflow]} |`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A ref Git reads as a revision: not empty, not an option, no whitespace. */
const isRef = (value) => typeof value === 'string' && /^[^-\s\u0000][^\s\u0000]*$/.test(value);

/**
 * The paths the change touches, as Git spells them: `-z` so that no name is quoted or split, and `--no-renames` so that a rename lists BOTH paths (`--name-only` with rename detection prints
 * only the new one, which would let a `go.mod` moved into docs/ look like documentation). Deleted files, new files and mode changes are paths too.
 */
export function changedPaths({ root = REPO_ROOT, base = 'HEAD^1', head = 'HEAD', env = process.env } = {}) {
  for (const [name, value] of [['base', base], ['head', head]]) {
    if (!isRef(value)) throw new Error(`the ${name} ref ${JSON.stringify(value)} is not a ref (it is empty, starts with "-" or holds whitespace)`);
  }
  const result = spawnSync('git', ['-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base, head, '--'], {
    encoding: 'utf8',
    env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new Error(`could not run git: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git diff ${base} ${head} failed (${result.status === null ? `signal ${result.signal}` : `exit ${result.status}`}): ${result.stderr.trim()}`);
  return result.stdout.split('\0').filter((entry) => entry !== '');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const USAGE = 'usage: node scripts/ci/changes.mjs [--root <repository>] [--base <ref>] [--head <ref>]';

/** A workflow command's message: `%`, CR and LF are the three characters it cannot carry. */
const escapeData = (value) => value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

export function main(argv = process.argv.slice(2), { env = process.env, out = (value) => process.stdout.write(value), err = (value) => process.stderr.write(value) } = {}) {
  const options = { root: REPO_ROOT, base: 'HEAD^1', head: 'HEAD' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--root', '--base', '--head'].includes(flag) || argv[i + 1] === undefined) {
      err(`${USAGE}\n`);
      return 2;
    }
    options[flag.slice(2)] = flag === '--root' ? path.resolve(argv[i + 1]) : argv[i + 1];
    i += 1;
  }

  let result;
  try {
    result = classify(changedPaths({ ...options, env }));
  } catch (error) {
    const message = show(error.message);
    err(`changes: ${message}\n`);
    if (env.GITHUB_ACTIONS === 'true') out(`::error title=Changed paths::${escapeData(message)}\n`);
    return 1;
  }

  const outputs = outputsOf(result);
  out(`changed paths: ${result.counts.docs + result.counts['new-ui'] + result.counts.other} (docs ${result.counts.docs}, new-ui ${result.counts['new-ui']}, other ${result.counts.other})\n`);
  for (const [name, value] of Object.entries(outputs)) out(`${name}=${value}\n`);
  if (env.GITHUB_ACTIONS === 'true') out(`::notice title=Changed paths::${Object.entries(outputs).map(([name, value]) => `${name}=${value}`).join(' ')}\n`);
  if (result.deciding.length > 0) {
    out('paths that decided it:\n');
    for (const file of result.deciding.slice(0, SHOWN)) out(`  - ${show(file)}\n`);
    if (result.deciding.length > SHOWN) out(`  - (${result.deciding.length - SHOWN} more)\n`);
  }
  try {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${renderSummary(result)}\n`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`).join(''));
  } catch (error) {
    err(`changes: could not write the outputs: ${show(error.message)}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
