/*
 * The vocabulary guard (decision A13): the host and the kit are plugin-agnostic, so the words of a plugin's domain (here: Kubernetes) are written nowhere in the
 * new trees. The scan reads every text file of `ui-next/` and of `packages/kit/`, and leaves out three places where such words are the subject and not a leak:
 *
 *   packages/kit/eslint        this guard: it defines the words, and its tests spell them
 *   packages/kit/probes        the recordings of the design mock, whose sample data is Kubernetes
 *   ui-next/plugins/fixture    the neutral fixture plugin: a plugin is not the host, and the words of a plugin's domain are its own
 *
 * A plugin's code lives in the plugin's repository. Nothing in this one is marked, exempt or temporary: there is no escape comment.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The repository root (this file is `packages/kit/eslint/vocabulary.mjs`). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Whole words that name a plugin's domain. Bare "cluster" is ordinary UI English (a cluster of items), so it is NOT matched. */
export const FORBIDDEN_VOCABULARY = /\b(?:pods?|namespaces?|kubectl|kubernetes|k8s|kubeconfig|kube)\b/gi;

export const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.css', '.html', '.md', '.json', '.yaml']);
const SKIPPED_NAMES = new Set(['node_modules', 'dist', 'coverage']);

/** The trees the scan reads, each with the directories (repo-relative, posix) it leaves out. */
export const TREES = [
  { dir: 'packages/kit', skipped: ['packages/kit/eslint', 'packages/kit/probes'] },
  { dir: 'ui-next', skipped: ['ui-next/plugins/fixture'] },
];

/** `usePods` -> `use Pods`, `KubernetesClient` -> `Kubernetes Client`, `HTMLPod` -> `HTML Pod`: so `\b` sees the words inside identifiers. */
const splitCase = (token) => token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

/** Scans one text. Returns the hits: `{ file, line, word }`, with `word` the whole original token (e.g. `usePods`). */
export function scanText(text, file = '<text>') {
  const hits = [];
  text.split('\n').forEach((content, index) => {
    for (const [token] of content.matchAll(/[A-Za-z0-9]+/g)) {
      if (splitCase(token).match(FORBIDDEN_VOCABULARY)) hits.push({ file, line: index + 1, word: token });
    }
  });
  return hits;
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

/** Scans the trees of `TREES` under `root`. A tree that does not exist is skipped. */
export function scanTrees(root = REPO_ROOT) {
  const hits = [];
  for (const { dir, skipped } of TREES) {
    let files;
    try {
      files = [...walk(path.join(root, dir), root, skipped)];
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const file of files) hits.push(...scanText(readFileSync(path.join(root, file), 'utf8'), file));
  }
  return hits;
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

/** The failure message: every `file:line:word`, and where a plugin's words belong. */
export function formatFailures(hits) {
  return [
    "Plugin vocabulary in the host or the kit (decision A13: both are plugin-agnostic; a plugin's code and its words live in the plugin's own repository).",
    'Name the thing neutrally. The only places these words may stand are the guard itself (packages/kit/eslint), the mock recordings (packages/kit/probes) and the neutral fixture plugin (ui-next/plugins/fixture).',
    ...hits.map(({ file, line, word }) => `  ${file}:${line}:${word}`),
  ].join('\n');
}
