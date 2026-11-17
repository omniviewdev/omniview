/*
 * The vocabulary guard (decision A13): the host and the kit are plugin-agnostic, so the words of a plugin's domain
 * (here: Kubernetes) are written only in a marked scaffolding directory, or between `SCAFFOLDING(N19): begin` and
 * `SCAFFOLDING(N19): end` comment lines.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FORBIDDEN_VOCABULARY, MARKER, REPO_ROOT, SCAFFOLDING } from './scaffolding.mjs';

export const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.css', '.html', '.md', '.json', '.yaml']);
const SKIPPED_NAMES = new Set(['node_modules', 'dist', 'coverage']);

const BEGIN = `${MARKER}: begin`;
const END = `${MARKER}: end`;

/** `usePods` -> `use Pods`, `KubernetesClient` -> `Kubernetes Client`, `HTMLPod` -> `HTML Pod`: so `\b` sees the words inside identifiers. */
const splitCase = (token) => token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

/**
 * Scans one text. Returns `{ hits, problems }`: `hits` are `{ file, line, word }` (word: the whole original token, e.g. `usePods`) outside a marked region; `problems`
 * are `{ file, line, message }` for an unmatched or nested marker. A marked region is exempt, marker lines included.
 */
export function scanText(text, file = '<text>') {
  const hits = [];
  const problems = [];
  let openedAt = 0;
  text.split('\n').forEach((content, index) => {
    const line = index + 1;
    if (content.includes(BEGIN)) {
      if (openedAt) problems.push({ file, line, message: `"${BEGIN}" inside the region opened at line ${openedAt}` });
      else openedAt = line;
      return;
    }
    if (content.includes(END)) {
      if (openedAt) openedAt = 0;
      else problems.push({ file, line, message: `"${END}" without a "${BEGIN}"` });
      return;
    }
    if (openedAt) return;
    for (const [token] of content.matchAll(/[A-Za-z0-9]+/g)) {
      if (splitCase(token).match(FORBIDDEN_VOCABULARY)) hits.push({ file, line, word: token });
    }
  });
  if (openedAt) problems.push({ file, line: openedAt, message: `"${BEGIN}" is never closed by "${END}"` });
  return { hits, problems };
}

function* walk(directory, root, skipped) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (SKIPPED_NAMES.has(entry.name) || skipped.includes(relative)) continue;
    if (entry.isDirectory()) yield* walk(absolute, root, skipped);
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) yield relative;
  }
}

/**
 * Scans the two trees under `root`: `packages/kit/` (minus the guard folder, which holds the probes, and `probes/`, the recordings of
 * the design mock, whose sample data is Kubernetes) and `ui-next/` (minus every scaffolding directory). A tree that does not exist is
 * skipped.
 */
export function scanTrees(root = REPO_ROOT) {
  const trees = [
    { dir: 'packages/kit', skipped: ['packages/kit/eslint', 'packages/kit/probes'] },
    { dir: 'ui-next', skipped: SCAFFOLDING },
  ];
  const hits = [];
  const problems = [];
  for (const { dir, skipped } of trees) {
    let files;
    try {
      files = [...walk(path.join(root, dir), root, skipped)];
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const file of files) {
      const result = scanText(readFileSync(path.join(root, file), 'utf8'), file);
      hits.push(...result.hits);
      problems.push(...result.problems);
    }
  }
  return { hits, problems };
}

/**
 * The files that may still hold plugin words. A RATCHET, so it only goes down: a file that is not listed fails on its first word, a
 * listed file fails when it gains a word, and fails when it has none left (delete its line). It is empty: the six files that merged
 * with the kit atoms (#515) while decision A13 was being written (25 words) were rewritten with neutral sample words in 1a.4b/1a.4c.
 */
export const RATCHET = Object.freeze({});

/** What the ratchet objects to: a file over its allowance (none, when it is not listed), and a listed file that has none left. */
export function ratchetFailures(hits, allowed = RATCHET) {
  const counts = new Map();
  for (const { file } of hits) counts.set(file, (counts.get(file) ?? 0) + 1);
  const failures = [];
  for (const [file, count] of counts) {
    const allowance = allowed[file] ?? 0;
    if (count > allowance) failures.push(`${file}: ${count} plugin words, ${allowance === 0 ? 'none allowed' : `${allowance} allowed`}`);
  }
  for (const file of Object.keys(allowed)) {
    if (!counts.has(file)) failures.push(`${file}: no plugin word left, remove it from RATCHET`);
  }
  return failures;
}

/** The failure message: every `file:line:word`, and where plugin vocabulary goes. */
export function formatFailures({ hits, problems }) {
  return [
    'Plugin vocabulary outside a marked scaffolding directory (decision A13: the host and the kit are plugin-agnostic).',
    'Move it into a scaffolding directory (ui-next/k8s, ui-next/pods), or wrap the lines in `SCAFFOLDING(N19): begin` / `SCAFFOLDING(N19): end` comments.',
    ...hits.map(({ file, line, word }) => `  ${file}:${line}:${word}`),
    ...problems.map(({ file, line, message }) => `  ${file}:${line}: ${message}`),
  ].join('\n');
}
