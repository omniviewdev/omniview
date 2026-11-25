// Names the failed tests of a `go test -json` stream as Markdown, for $GITHUB_STEP_SUMMARY, so that a flake is named without reading a 7 MB log.
//
//   node scripts/go-test-failures.mjs <go-test.jsonl>      prints nothing when no test failed, none was skipped, or the file is absent
//
// What it reports, per package:
//   - every test that failed (a parent whose subtest failed is not listed twice), with the first lines of what it printed;
//   - when the test binary died (a panic, a timeout, os.Exit) the failing test is not named by the stream: the tests that started and never finished are, and the ones whose
//     output holds the panic come first;
//   - a package that did not build, with its compiler output.
//   - after them, how many tests were skipped, for each reason they gave (the text before the first colon of the skip message: `slow` is the tier that `go test -short` skips), so that a skip is never silent.
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
  const packages = new Map(); // package -> { failed, failedBuild }
  const builds = new Map(); // import path -> compiler output
  const importPath = (name) => name.replace(/ \[.*\]$/, '');
  const pkgOf = (name) => {
    if (!packages.has(name)) packages.set(name, { failed: false, failedBuild: '' });
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
      const path = importPath(event.ImportPath);
      if (!builds.has(path)) builds.set(path, []);
      builds.get(path).push(event.Output ?? '');
      continue;
    }
    if (!event.Package) continue;
    const pkg = pkgOf(event.Package);
    if (!event.Test) {
      if (event.Action === 'fail') {
        pkg.failed = true;
        if (event.FailedBuild) pkg.failedBuild = importPath(event.FailedBuild);
      }
      continue;
    }
    const key = `${event.Package}\0${event.Test}`;
    if (!tests.has(key)) tests.set(key, { pkg: event.Package, test: event.Test, state: 'running', output: [] });
    const test = tests.get(key);
    if (event.Action === 'output') test.output.push(...(event.Output ?? '').split('\n').filter((row) => row !== ''));
    else if (event.Action === 'pass') test.state = 'done';
    else if (event.Action === 'skip') Object.assign(test, { state: 'done', skipped: true });
    else if (event.Action === 'fail') test.state = 'failed';
  }

  const all = [...tests.values()];
  // What a test itself said, without the framework's lines (a subtest's summary is indented under its parent).
  const own = (test) => test.output.filter((row) => row.trim() !== '' && !FRAME.test(row.trimStart()));
  const failedChild = (test) => all.some((other) => other.state === 'failed' && other.pkg === test.pkg && other.test.startsWith(`${test.test}/`));
  // A parent is listed beside its failed subtest only when it said something of its own (a cleanup failure, an error after the subtests).
  const failed = all.filter((test) => test.state === 'failed' && (!failedChild(test) || own(test).length > 0));
  const died = new Map(); // package -> the tests that were running when its binary died
  const unbuilt = [];
  for (const [name, pkg] of packages) {
    if (!pkg.failed) continue;
    const unfinished = all.filter((test) => test.pkg === name && test.state === 'running');
    const culprits = unfinished.filter((test) => test.output.some((row) => /^(panic:|fatal error:)/.test(row)));
    if (culprits.length > 0) died.set(name, culprits);
    else if (failed.some((test) => test.pkg === name)) continue;
    else if (unfinished.length > 0) died.set(name, unfinished);
    else unbuilt.push({ pkg: name, via: pkg.failedBuild && pkg.failedBuild !== name ? pkg.failedBuild : '', output: builds.get(pkg.failedBuild || name) ?? [] });
  }
  return { failed, died, unbuilt, skipped: all.filter((test) => test.skipped) };
}

const short = (pkg) => pkg.replace(MODULE, '');

function block(rows) {
  const shown = rows.map((row) => row.replace(/\s+$/, '')).filter((row) => row !== '' && !FRAME.test(row.trimStart())).slice(0, MAX_LINES);
  if (shown.length === 0) return '';
  const body = shown.map((row) => `  ${(row.length > MAX_WIDTH ? `${row.slice(0, MAX_WIDTH)}…` : row).replaceAll('```', "'''")}`);
  return `\n  \`\`\`\n${body.join('\n')}\n  \`\`\``;
}

/** The Markdown for a job summary; empty when nothing failed. */
export function render({ failed, died, unbuilt }, attempt = '') {
  const entries = [];
  for (const test of failed) entries.push(`- \`${short(test.pkg)}\` **${test.test}**${block(test.output)}`);
  for (const [pkg, tests] of died) {
    for (const test of tests.slice(0, MAX_LINES)) {
      // From the panic row on, so that a long stack cannot push the cause out of the excerpt.
      const at = test.output.findIndex((row) => /^(panic:|fatal error:)/.test(row));
      entries.push(`- \`${short(pkg)}\` **${test.test}** (the test binary died while it ran)${block(at >= 0 ? test.output.slice(at) : test.output.slice(-MAX_LINES * 2))}`);
    }
  }
  for (const { pkg, via, output } of unbuilt) entries.push(`- \`${short(pkg)}\` failed without a failed test (${via ? `\`${short(via)}\` did not build` : 'build or setup'})${block(output)}`);
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

// A skipped test says why in its last `file.go:12: message` row (`t.Skip` logs the message, then stops the test). The reason is the text before the first colon: `slow: dev workspace ...` is `slow`.
const SKIP_MESSAGE = /^\s*\S+\.go:\d+: (.*)$/;
const MAX_REASONS = 12;

function reasonOf(test) {
  const rows = test.output.filter((row) => SKIP_MESSAGE.test(row));
  if (rows.length === 0) return '(no reason given)';
  const message = SKIP_MESSAGE.exec(rows.at(-1))[1].trim();
  const colon = message.indexOf(':');
  return (colon > 0 ? message.slice(0, colon) : message).slice(0, 60);
}

/** The Markdown for a job summary: how many tests were skipped, for each reason they gave; empty when none was. */
export function renderSkips(skipped) {
  const counts = new Map();
  for (const test of skipped) {
    const reason = reasonOf(test);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = rows.slice(0, MAX_REASONS).map(([reason, count]) => `| ${reason.replaceAll('|', '\\|')} | ${count} |`);
  if (rows.length > MAX_REASONS) lines.push(`| … ${rows.length - MAX_REASONS} more reasons | ${rows.slice(MAX_REASONS).reduce((sum, [, count]) => sum + count, 0)} |`);
  return ['### Go tests skipped', '', '| Reason | Tests |', '|---|--:|', ...lines, '', '`slow` is the tier that `-short` skips and the nightly runs (rule 40 of docs/ui-next/AGENTS.md).', ''].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (file && existsSync(file)) {
    const result = failures(readFileSync(file, 'utf8'));
    process.stdout.write([render(result, process.env.GITHUB_RUN_ATTEMPT), renderSkips(result.skipped)].filter((part) => part !== '').join('\n'));
  }
}
