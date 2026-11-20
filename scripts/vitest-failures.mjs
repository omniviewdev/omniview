// Writes the outcome of vitest JSON reports as Markdown, for $GITHUB_STEP_SUMMARY: a failure names its files and tests with the first line of each assertion message,
// a pass is one line of counts. The default reporter's console output stays the full record; this is what a reader sees first.
//
//   node scripts/vitest-failures.mjs <label>=<report.json> ...      a report that is absent or unreadable is said so in the output
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_TESTS = 30;
const MAX_WIDTH = 300;

const firstLine = (messages) => {
  const text = (messages ?? []).join('\n').replace(/\u001b\[[0-9;]*m/g, '');
  const line = text.split('\n').find((row) => row.trim() !== '') ?? '';
  return line.length > MAX_WIDTH ? `${line.slice(0, MAX_WIDTH)}…` : line;
};

/** One section for a vitest JSON report: the failed tests (at most MAX_TESTS), or one line of counts. */
export function summarize(label, report, root = '') {
  const rel = (name) => (root && name.startsWith(root) ? name.slice(root.length).replace(/^\//, '') : name);
  const failed = [];
  for (const file of report.testResults ?? []) {
    const named = (file.assertionResults ?? []).filter((test) => test.status === 'failed');
    for (const test of named) failed.push({ file: rel(file.name), name: test.fullName || test.title, message: firstLine(test.failureMessages) });
    // A file that failed before any test ran (an import error, a throw at module scope) has no failed test of its own.
    if (file.status === 'failed' && named.length === 0) failed.push({ file: rel(file.name), name: '(the file failed before its tests ran)', message: firstLine([file.message]) });
  }
  const total = report.numTotalTests ?? 0;
  const files = (report.testResults ?? []).length;
  if (failed.length === 0 && report.success !== false) return `**${label}**: ${report.numPassedTests ?? 0} of ${total} tests passed in ${files} files${report.numPendingTests ? `, ${report.numPendingTests} skipped` : ''}\n`;
  const rows = failed.slice(0, MAX_TESTS).map((test) => `- \`${test.file}\` **${test.name}**${test.message ? `\n  \`${test.message.replaceAll('`', "'")}\`` : ''}`);
  const more = failed.length > MAX_TESTS ? `\n- … and ${failed.length - MAX_TESTS} more; see the log` : '';
  return [`### ${label}: ${report.numFailedTests ?? failed.length} of ${total} tests failed`, '', rows.join('\n') + more, ''].join('\n');
}

/** The sections for `label=file` arguments, in order. */
export function render(args, root = '') {
  const sections = [];
  for (const arg of args) {
    const at = arg.indexOf('=');
    const label = arg.slice(0, at);
    const file = arg.slice(at + 1);
    if (!existsSync(file)) {
      sections.push(`### ${label}: no report was written (the step did not run, or vitest died before it wrote one)\n`);
      continue;
    }
    try {
      sections.push(summarize(label, JSON.parse(readFileSync(file, 'utf8')), root));
    } catch (error) {
      sections.push(`### ${label}: the report could not be read (vitest died while writing it? ${error.message})\n`);
    }
  }
  return sections.join('\n');
}

// Prints the summary to the log (folded) and appends it to $GITHUB_STEP_SUMMARY when set. Always exits 0: the exit code of the job is vitest's, not this script's.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = render(process.argv.slice(2), `${process.cwd()}/`);
  process.stdout.write(`::group::Job summary text\n${text}\n::endgroup::\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
