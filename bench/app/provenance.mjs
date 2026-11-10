/**
 * What was measured: the harness's own bytes, the shared UI packages exactly as the app root
 * resolves them, and a build manifest that travels with a built frontend so a reused or
 * supplied build can be trusted only as far as its bytes still match it.
 *
 * Declared versions are not evidence. `@omniviewdev/base-ui ~0.17.1` says nothing about
 * whether a source-linked workspace build or a published package was bundled; the resolved
 * real path, its version, the git state of a linked checkout and the hash of its `dist` do.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { fileSHA256, gitSourceIdentity, hashDirectoryTree } from './plugin-bundle.mjs';

export const MANIFEST_NAME = '.ov-bench-build.json';
export const MANIFEST_SCHEMA = 'ov-bench-build/v1';

/** Packages whose resolved bytes the host bundles into the frontend. */
export const UI_PACKAGES = Object.freeze([
  '@omniviewdev/base-ui',
  '@omniviewdev/ai-ui',
  '@omniviewdev/editors',
  '@omniviewdev/providers',
  '@omniviewdev/runtime',
]);

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const posix = (relative) => relative.split(path.sep).join('/');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// Directories and extensions of the files that make up the harness at run time.
const HARNESS_ROOTS = ['bench/app', 'bench/render/fixtures', 'bench/render/harness', 'bench/vite'];
const HARNESS_EXTENSIONS = new Set(['.mjs', '.js', '.ts', '.tsx', '.css', '.html']);
const HARNESS_SKIPPED_DIRECTORIES = new Set(['results', 'dist', '.local', 'node_modules', 'build-plugin']);
// The report only reads finished results; it cannot change what a run measures.
const HARNESS_EXCLUDED_FILES = new Set(['bench/app/report.mjs']);

/** Every harness file by relative path, in a stable order. Tests and receipts are not harness code. */
export function harnessFiles(harnessRoot) {
  const out = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!HARNESS_SKIPPED_DIRECTORIES.has(entry.name)) walk(file);
      } else if (entry.isFile() && HARNESS_EXTENSIONS.has(path.extname(entry.name)) && !/\.(test|spec|bench)\./.test(entry.name)) {
        const relative = posix(path.relative(harnessRoot, file));
        if (!HARNESS_EXCLUDED_FILES.has(relative)) out.push(relative);
      }
    }
  };
  for (const root of HARNESS_ROOTS) walk(path.join(harnessRoot, root));
  return out.sort();
}

/**
 * The harness checkout's identity: its git state and a hash of exactly the files that execute.
 * Two runs with the same `treeSHA256` ran the same harness bytes, whatever each target checkout is.
 */
export function harnessIdentity(harnessRoot) {
  const tree = createHash('sha256');
  let bytes = 0;
  const files = harnessFiles(harnessRoot);
  for (const name of files) {
    const content = fs.readFileSync(path.join(harnessRoot, name));
    bytes += content.length;
    tree.update(`${name}\0${createHash('sha256').update(content).digest('hex')}\n`);
  }
  return { root: harnessRoot, files: files.length, bytes, treeSHA256: tree.digest('hex'), git: gitSourceIdentity(harnessRoot) };
}

/**
 * The shared UI packages as `appRoot` resolves them through node_modules, at their real path.
 * A package linked to a checkout (outside any node_modules directory) gets that checkout's git
 * identity; one installed from the package store is identified by version and `dist` bytes. A
 * workspace package of the host repository is identified by the host's own source identity.
 */
export function uiPackageProvenance(appRoot, names = UI_PACKAGES) {
  const root = fs.realpathSync(appRoot);
  const manifest = readJson(path.join(root, 'package.json')) ?? {};
  const declared = { ...manifest.devDependencies, ...manifest.dependencies };
  const out = {};
  for (const name of names) {
    const link = path.join(root, 'node_modules', ...name.split('/'));
    let real;
    try {
      real = fs.realpathSync(link);
    } catch {
      out[name] = { state: 'unresolved', declared: declared[name] ?? null, reason: `${name} is not installed under the app root` };
      continue;
    }
    const pkg = readJson(path.join(real, 'package.json'));
    const fromStore = real.split(path.sep).includes('node_modules');
    const workspacePackage = !fromStore && isInside(root, real);
    const dist = path.join(real, 'dist');
    const entry = {
      state: 'resolved',
      declared: declared[name] ?? null,
      realPath: real,
      version: pkg?.version ?? null,
      source: fromStore ? 'package-store' : workspacePackage ? 'host-workspace' : 'linked-checkout',
      dist: fs.existsSync(dist) ? hashDirectoryTree(dist) : { state: 'absent', reason: 'the package has no dist directory; the app consumes its source' },
    };
    if (entry.source === 'linked-checkout') entry.git = gitSourceIdentity(real);
    out[name] = entry;
  }
  return out;
}

/** Write the manifest that describes the frontend in `distDir`, hashing the bytes as they are now. */
export function writeBuildManifest(distDir, manifest) {
  const bundle = hashDirectoryTree(distDir, { exclude: [MANIFEST_NAME] });
  const full = { schema: MANIFEST_SCHEMA, createdAt: new Date().toISOString(), ...manifest, bundle };
  fs.writeFileSync(path.join(distDir, MANIFEST_NAME), `${JSON.stringify(full, null, 2)}\n`);
  return full;
}

/**
 * Read a build's manifest and check it against the bytes now on disk. A manifest is evidence
 * of how a build was produced only while the bundle it recorded is the bundle present.
 *
 * - `verified`: manifest found and the tree hash matches.
 * - `unverified`: manifest found but the bytes differ; its claims are not used.
 * - `absent`: no manifest (a build from an older runner).
 */
export function readBuildManifest(distDir) {
  const file = path.join(distDir, MANIFEST_NAME);
  if (!fs.existsSync(file)) return { state: 'absent', reason: 'no build manifest beside the bundle (built by an older runner)' };
  const manifest = readJson(file);
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || !manifest.bundle?.treeSHA256) {
    return { state: 'unverified', reason: 'the build manifest is unreadable or has another schema' };
  }
  const present = hashDirectoryTree(distDir, { exclude: [MANIFEST_NAME] });
  if (present.treeSHA256 !== manifest.bundle.treeSHA256) {
    return { state: 'unverified', reason: 'the bundle on disk differs from the bundle the manifest recorded', manifest };
  }
  return { state: 'verified', manifest };
}

/** SHA-256 of the selected app root's vite.config.ts, or null when unreadable. */
export const appConfigSHA256 = (appRoot) => fileSHA256(path.join(appRoot, 'vite.config.ts'));

export { sha256 as sha256Text };
