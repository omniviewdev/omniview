// The directory a shard's builds are shared in, the key that names it, and what a shard's log says about its builds (N27, docs/ui-next/status/N27.md).
//
// THE KEY. Every process of a shard reads and writes builds under one BUILD_CACHE (packages/kit/probes/build-cache.mjs). The shard's job gets that directory fresh (it is under $RUNNER_TEMP), so within a run no build can be stale; the
// directory is named by the hash of everything that can change what a build makes so that it could not be stale either if it ever lived longer than a job (a self-hosted runner, a cache restored by a workflow): a build made from
// another tree, another lockfile, another Node, another platform or other build variables is in another directory, and nothing is restored across commits unless its key is the content's.
//   the files    every file of the repository that a build may read: the whole tree except node_modules, .git and the root's own dist (the output of the channel's build, which no probe reads); a built package's `dist` IS read (the
//                fixtures import the built kit), so it is in. The lockfile is among the files: it pins node_modules.
//   node         the version, the platform and the architecture (the React Compiler and the minifier are native code).
//   variables    the ones a build reads: OMNIVIEW_*, WAILS_*, VITE_*, VITEST* and NODE_ENV and the few Node and Browserslist names (BUILD_ENV_PREFIXES, BUILD_ENV_NAMES). A test reads the sources of the build and fails when one
//                reads a variable these do not name. NOT the knobs of a probe: the control, the fonts' delay (read by the static server, never baked in: a test reads the tree for it), the report, the engines and viewports. Units that
//                set other knobs must share one build.
//
// THE LINES. A build prints `probe-build: <kind>/<mode> built in <s> s (shared|not shared)` or `... reused`; the runner of a shard counts them, so that a shard's log and summary say what it built, in how long, and how many reads it saved.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The prefixes of the variables a build reads (vite.config.ts, the Vite plugin, the packages' own configurations). */
export const BUILD_ENV_PREFIXES = ['OMNIVIEW_', 'WAILS_', 'VITE_', 'VITEST'];
/** The other names a build is changed by: Vite's mode, and what Node and Browserslist read. */
export const BUILD_ENV_NAMES = ['NODE_ENV', 'NODE_OPTIONS', 'BABEL_ENV', 'BROWSERSLIST', 'BROWSERSLIST_ENV'];
/** Moves when the way the key is made changes, so that no key of the old way is a key of the new one. */
export const KEY_VERSION = 1;

export const isBuildEnv = (name) => BUILD_ENV_NAMES.includes(name) || BUILD_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);
/** Directories of the repository root that a build does not read: the channel's own output, and what a run leaves. */
const SKIPPED_AT_ROOT = new Set(['dist', 'bin', 'test-results']);

/** Every file under `root` a build may read, as `/`-separated paths from the root, sorted. A link to a file is a file; a link to a directory is not followed. */
export function buildInputs(root) {
  const found = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || (prefix === '' && SKIPPED_AT_ROOT.has(entry.name))) continue;
        walk(path.join(directory, entry.name), relative);
      } else if (entry.isFile() || (entry.isSymbolicLink() && statSync(path.join(root, relative), { throwIfNoEntry: false })?.isFile() === true)) {
        found.push(relative);
      }
    }
  };
  walk('', '');
  return found.sort();
}

/** The key of a shard's builds: a hexadecimal SHA-256 of the files, the lockfile among them, node, platform, architecture and the build variables of `env`. */
export function buildKey({ root, env, node = process.version, platform = process.platform, arch = process.arch }) {
  const hash = createHash('sha256');
  hash.update(`probe-build-key ${KEY_VERSION}\0node ${node}\0platform ${platform}\0arch ${arch}\0`);
  for (const name of Object.keys(env).filter(isBuildEnv).sort()) {
    if (env[name] !== undefined) hash.update(`env ${name}=${env[name]}\0`);
  }
  for (const file of buildInputs(root)) {
    hash.update(`file ${file} ${createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')}\0`);
  }
  return hash.digest('hex');
}

/** The directory the processes of a shard share their builds in: `<runner temp>/probe-builds/<the first 16 hexadecimal digits of the key>`. */
export function shardBuildCache({ root, env, tmp = os.tmpdir(), ...rest }) {
  const key = buildKey({ root, env, ...rest });
  return path.join(env.RUNNER_TEMP === undefined || env.RUNNER_TEMP === '' ? tmp : env.RUNNER_TEMP, 'probe-builds', key.slice(0, 16));
}

const BUILD_LINE = /^probe-build: ([a-z0-9-]+)\/([a-z]+) (?:built in ([\d.]+) s \((shared|not shared)\)|reused)$/;

/** The builds a probe's output says it made or read: `[{ kind, mode, action: 'built' | 'reused', seconds, shared }]`. A line that does not start with `probe-build: ` and nothing else on it is not one. */
export function parseBuilds(text) {
  const found = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = BUILD_LINE.exec(line);
    if (match === null) continue;
    const built = match[3] !== undefined;
    found.push({ kind: match[1], mode: match[2], action: built ? 'built' : 'reused', seconds: built ? Number(match[3]) : 0, shared: built ? match[4] === 'shared' : true });
  }
  return found;
}

/** The builds of a shard added up for each kind and mode: `{ rows: [{ kind, mode, built, reused, seconds }], built, reused, seconds }` (the seconds are those of the builds that were made). */
export function summariseBuilds(list) {
  const rows = new Map();
  for (const build of list) {
    const key = `${build.kind}/${build.mode}`;
    const row = rows.get(key) ?? { kind: build.kind, mode: build.mode, built: 0, reused: 0, seconds: 0 };
    if (build.action === 'built') {
      row.built += 1;
      row.seconds += build.seconds;
    } else row.reused += 1;
    rows.set(key, row);
  }
  const sorted = [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
  return { rows: sorted, built: sorted.reduce((sum, row) => sum + row.built, 0), reused: sorted.reduce((sum, row) => sum + row.reused, 0), seconds: sorted.reduce((sum, row) => sum + row.seconds, 0) };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The builds of a shard (Markdown): a row for each kind and mode, and a line that says what they cost and what reading them saved from being made again. Nothing when the shard built and read nothing. */
export function renderBuilds(id, summary) {
  if (summary.rows.length === 0) return '';
  const lines = [`#### Kit probes shard ${id}: builds`, '', '| Build | Built | Reused | Seconds building |', '|---|--:|--:|--:|'];
  for (const row of summary.rows) lines.push(`| ${row.kind}/${row.mode} | ${row.built} | ${row.reused} | ${Math.round(row.seconds)} |`);
  lines.push('', `${plural(summary.built, 'build')} took ${Math.round(summary.seconds)} s and ${plural(summary.reused, 'read')} reused ${summary.reused === 1 ? 'one' : 'them'}.`);
  return `${lines.join('\n')}\n`;
}
