import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** OV_K8S_PLUGIN_DIST names the assets directory, not dist or an entry file. */
export function pluginAssetDirectory(root, override = process.env.OV_K8S_PLUGIN_DIST) {
  if (override !== undefined && !override.trim()) {
    throw new Error('OV_K8S_PLUGIN_DIST must name a built Kubernetes UI assets directory');
  }
  return path.resolve(root, override ?? 'plugins/kubernetes/ui/dist/assets');
}

/** OV_K8S_PLUGIN_METADATA names plugin.json. Like the assets override, a relative path resolves from the host root. */
export function pluginMetadataFile(root, override = process.env.OV_K8S_PLUGIN_METADATA) {
  if (override !== undefined && !override.trim()) {
    throw new Error('OV_K8S_PLUGIN_METADATA must name the selected Kubernetes plugin.json');
  }
  return path.resolve(root, override ?? 'plugins/kubernetes/plugin.json');
}

export function requirePluginBundle(assets) {
  const entry = path.join(assets, 'entry.js');
  const stat = fs.statSync(entry, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(`Kubernetes UI bundle is missing a nonempty regular entry.js: ${entry}`);
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fullCommit = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** SHA-256 of a file's bytes, or null when it cannot be read. */
export function fileSHA256(file) {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/**
 * Every file the preview server can serve from the selected assets directory,
 * identified by relative path and content. Selecting a bundle by path alone
 * cannot say which bytes were measured.
 */
export function hashPluginBundle(assets) {
  const files = [];
  const visited = new Set();
  const walk = (directory) => {
    const real = fs.realpathSync(directory);
    if (visited.has(real)) return;
    visited.add(real);
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push({ file, name: path.relative(assets, file).split(path.sep).join('/') });
      else throw new Error(`Kubernetes UI bundle entry is neither a regular file nor a directory: ${file}`);
    }
  };
  walk(assets);
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const tree = createHash('sha256');
  let bytes = 0;
  let entrySHA256;
  for (const { file, name } of files) {
    const content = fs.readFileSync(file);
    const digest = sha256(content);
    bytes += content.length;
    if (name === 'entry.js') entrySHA256 = digest;
    tree.update(`${name}\0${digest}\n`);
  }
  return { files: files.length, bytes, entrySHA256, treeSHA256: tree.digest('hex') };
}

/**
 * A read-only git query. A missing binary, a missing directory, a directory
 * outside any repository and a nonzero exit are all a failed lookup, reported
 * as undefined, never as an empty answer and never as a thrown error.
 */
function gitOutput(directory, args, { executable = 'git', bytes = false } = {}) {
  const result = spawnSync(executable, ['--no-optional-locks', '-C', directory, ...args], {
    encoding: bytes ? 'buffer' : 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) return undefined;
  if (bytes) return Buffer.isBuffer(result.stdout) ? result.stdout : undefined;
  return typeof result.stdout === 'string' ? result.stdout.trim() : undefined;
}

/**
 * Identity of a checkout as bench/app/real-resource.mjs records it: the full
 * HEAD, whether tracked files differ from it, and a hash of that tracked diff.
 * Untracked files are not part of this identity. A dirty checkout is only
 * reproducible if its diff and built artifacts were retained; the hash lets
 * a retained diff be verified, nothing more.
 */
export function gitSourceIdentity(directory, options) {
  const head = gitOutput(directory, ['rev-parse', 'HEAD'], options);
  if (!head || !fullCommit.test(head)) {
    return { state: 'unknown', reason: 'git could not resolve HEAD of the selected checkout' };
  }
  const status = gitOutput(directory, ['status', '--porcelain', '--untracked-files=no'], options);
  const diff = gitOutput(directory, ['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD'], { ...options, bytes: true });
  return {
    state: 'identified',
    head,
    short: gitOutput(directory, ['rev-parse', '--short', 'HEAD'], options) || head.slice(0, 8),
    dirty: status === undefined ? null : status !== '',
    trackedDiffSHA256: diff === undefined ? null : sha256(diff),
  };
}

// The native form restores the on-disk case, so a differently-cased path still compares equal to git's.
const realpathOrUndefined = (target) => {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return undefined;
  }
};

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * The checkout that really holds the selected plugin inputs, or unknown.
 *
 * A metadata file's parent directory is not evidence by itself: git resolves
 * the enclosing repository, which is the host when the plugins/kubernetes
 * submodule is absent. A checkout is identified only when it is a repository
 * other than the host, tracks the selected metadata file, and contains the
 * selected assets directory.
 */
export function pluginCheckoutIdentity({ hostRoot, metadataFile, assets }, options) {
  const unknown = (reason) => ({ state: 'unknown', reason });
  const metadata = realpathOrUndefined(metadataFile);
  if (!metadata) return unknown('the selected plugin metadata file does not exist');
  const top = gitOutput(path.dirname(metadata), ['rev-parse', '--show-toplevel'], options);
  const checkout = top ? realpathOrUndefined(top) : undefined;
  if (!checkout) return unknown('the selected plugin metadata is not inside a git checkout, or git is unavailable');
  const hostTop = gitOutput(hostRoot, ['rev-parse', '--show-toplevel'], options);
  if (hostTop && realpathOrUndefined(hostTop) === checkout) {
    return unknown('the selected plugin metadata resolves to the host repository, not a separate plugin checkout (for example an uninitialized plugins/kubernetes submodule)');
  }
  const tracked = gitOutput(checkout, ['ls-files', '--error-unmatch', '--', path.relative(checkout, metadata).split(path.sep).join('/')], options);
  if (tracked === undefined) return unknown('the selected plugin metadata is not a tracked file of the repository that contains it');
  const bundle = realpathOrUndefined(assets);
  if (!bundle || !isInside(checkout, bundle)) {
    return unknown('the selected plugin bundle is outside the repository that contains the plugin metadata, so its source commit is not proven');
  }
  return gitSourceIdentity(checkout, options);
}
