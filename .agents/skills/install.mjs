import { lstat, mkdir, readlink, realpath, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately has no destination option: adapters stay in this host checkout.
const names = [
  'omniview-workspaces',
  'omniview-repo-map',
  'omniview-instance-verification',
];
const skills = dirname(fileURLToPath(import.meta.url));
const root = resolve(skills, '../..');

async function statOrMissing(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function install() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--client' || !['codex', 'claude'].includes(args[1])) {
    throw new Error('Usage: node .agents/skills/install.mjs --client codex|claude');
  }
  if (await realpath(root) !== root || await realpath(skills) !== skills) {
    throw new Error('Refusing an aliased checkout or skill source directory');
  }
  for (const name of names) {
    const directory = join(skills, name);
    const info = await lstat(directory);
    const entry = await lstat(join(directory, 'SKILL.md'));
    if (!info.isDirectory() || info.isSymbolicLink() || !entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Expected canonical versioned skill: ${name}`);
    }
  }
  if (args[1] === 'codex') {
    console.log(`Codex repository discovery: ${skills}\n${names.join('\n')}`);
    return;
  }
  const parents = [join(root, '.claude'), join(root, '.claude', 'skills')];
  for (const path of parents) {
    const info = await statOrMissing(path);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(`Refusing non-directory or symlinked adapter parent: ${path}`);
    }
  }
  const destination = parents[1];
  const pending = [];
  // Check every existing entry before creating anything. Never replace entries.
  for (const name of names) {
    const path = join(destination, name);
    const target = relative(destination, join(skills, name));
    const info = await statOrMissing(path);
    if (info) {
      if (!info.isSymbolicLink() || await readlink(path) !== target) {
        throw new Error(`Existing unrelated skill entry retained: ${path}`);
      }
    } else {
      pending.push({ path, target });
    }
  }
  for (const path of parents) {
    try {
      await mkdir(path);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Adapter parent changed; refusing: ${path}`);
    }
  }
  // EEXIST remains an error if another writer creates an entry after preflight.
  // A partial install is harmless and resumable; no recursive cleanup is used.
  for (const { path, target } of pending) await symlink(target, path, 'dir');
  console.log(`Claude Code local skill adapters: ${destination}\n${names.join('\n')}`);
}

install().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
