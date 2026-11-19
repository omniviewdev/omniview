// Names the failed tests of a `go test -json` stream as Markdown, for $GITHUB_STEP_SUMMARY, so that a flake is named without reading a 7 MB log.
//
//   node scripts/go-test-failures.mjs <go-test.jsonl>      prints nothing when no test failed or the file is absent
//
// What it reports, per package:
//   - every test that failed (a parent whose subtest failed is not listed twice), with the first lines of what it printed;
//   - when the test binary died (a panic, a timeout, os.Exit) the failing test is not named by the stream: the tests that started and never finished are, and the ones whose
//     output holds the panic come first;
//   - a package that did not build, with its compiler output.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODULE = 'github.com/omniviewdev/omniview/';
const MAX_ENTRIES = 50;
const MAX_LINES = 10;
const MAX_WIDTH = 240;
// test2json frames, not what the test said.
const FRAME = /^(=== (RUN|PAUSE|CONT|NAME)\b|--- (FAIL|PASS|SKIP):|PASS$|FAIL$|exit status \d+$)/;

/** What a `go test -json` stream says went wrong: failed tests, tests unfinished when a package died, packages that did not build. */
export function failures(text) {
  const tests = new Map(); // `${package}\0${test}` -> { pkg, test, state, output }
  const packages = new Map(); // package -> { failed, build }
  const pkgOf = (name) => {
    if (!packages.has(name)) packages.set(name, { failed: false, build: [] });
    return packages.get(name);
  };
  for (const line of text.split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event === null || typeof event !== 'object') continue;
    if (event.Action === 'build-output' && event.ImportPath) {
      pkgOf(event.ImportPath.replace(/ \[.*\]$/, '')).build.push(event.Output ?? '');
      continue;
    }
    if (!event.Package) continue;
    const pkg = pkgOf(event.Package);
    if (!event.Test) {
      if (event.Action === 'fail') pkg.failed = true;
      continue;
    }
    const key = `${event.Package}\0${event.Test}`;
    if (!tests.has(key)) tests.set(key, { pkg: event.Package, test: event.Test, state: 'running', output: [] });
    const test = tests.get(key);
    if (event.Action === 'output') test.output.push(...(event.Output ?? '').split('\n').filter((row) => row !== ''));
    else if (event.Action === 'pass' || event.Action === 'skip') test.state = 'done';
    else if (event.Action === 'fail') test.state = 'failed';
  }

  const all = [...tests.values()];
  const failed = all.filter((test) => test.state === 'failed' && !all.some((other) => other.state === 'failed' && other.pkg === test.pkg && other.test.startsWith(`${test.test}/`)));
  const died = new Map(); // package -> tests that never finished, when the package failed without a failed test
  const unbuilt = [];
  for (const [name, pkg] of packages) {
    if (!pkg.failed || failed.some((test) => test.pkg === name)) continue;
    const unfinished = all.filter((test) => test.pkg === name && test.state === 'running');
    const culprits = unfinished.filter((test) => test.output.some((row) => /^(panic:|fatal error:)/.test(row)));
    if (culprits.length > 0 || unfinished.length > 0) died.set(name, culprits.length > 0 ? culprits : unfinished);
    else unbuilt.push({ pkg: name, output: pkg.build });
  }
  return { failed, died, unbuilt };
}

const short = (pkg) => pkg.replace(MODULE, '');

function block(rows) {
  const shown = rows.map((row) => row.replace(/\s+$/, '')).filter((row) => row !== '' && !FRAME.test(row)).slice(0, MAX_LINES);
  if (shown.length === 0) return '';
  const body = shown.map((row) => `  ${(row.length > MAX_WIDTH ? `${row.slice(0, MAX_WIDTH)}…` : row).replaceAll('```', "'''")}`);
  return `\n  \`\`\`\n${body.join('\n')}\n  \`\`\``;
}

/** The Markdown for a job summary; empty when nothing failed. */
export function render({ failed, died, unbuilt }, attempt = '') {
  const entries = [];
  for (const test of failed) entries.push(`- \`${short(test.pkg)}\` **${test.test}**${block(test.output)}`);
  for (const [pkg, tests] of died) {
    for (const test of tests.slice(0, MAX_LINES)) entries.push(`- \`${short(pkg)}\` **${test.test}** (the test binary died while it ran)${block(test.output.slice(-MAX_LINES * 2))}`);
  }
  for (const { pkg, output } of unbuilt) entries.push(`- \`${short(pkg)}\` failed without a failed test (build or setup)${block(output)}`);
  if (entries.length === 0) return '';
  const more = entries.length > MAX_ENTRIES ? `\n- … and ${entries.length - MAX_ENTRIES} more; see the log` : '';
  return [
    `### Go tests failed${attempt ? ` (run attempt ${attempt})` : ''}`,
    '',
    entries.slice(0, MAX_ENTRIES).join('\n') + more,
    '',
    'A test that fails here and passes on re-run is a flake: record its name, package and the output above before re-running it.',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (file && existsSync(file)) process.stdout.write(render(failures(readFileSync(file, 'utf8')), process.env.GITHUB_RUN_ATTEMPT));
}
