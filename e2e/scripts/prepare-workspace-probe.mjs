import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { devNull } from 'node:os';

const pluginID = 'workspace-probe';
const fixture = fileURLToPath(new URL('../fixtures/workspace-probe/', import.meta.url));
// Explicit source allowlist: never copy a developer's outputs, dependencies, Git
// directory, credentials, or workspace-local module overrides into the source.
const files = [
  '.gitignore',
  'go.mod',
  'go.sum',
  'plugin.yaml',
  'pkg/main.go',
  'pkg/resource-benchmark.go',
  'pkg/resource-benchmark_test.go',
  'pkg/resource-events_test.go',
  'pkg/resource-corpus.json',
  'ui/package.json',
  'ui/pnpm-workspace.yaml',
  'ui/pnpm-lock.yaml',
  'ui/tsconfig.json',
  'ui/vite.config.ts',
  'ui/vite/omniview.ts',
  'ui/src/entry.ts',
  'ui/src/ProbePage.tsx',
  'ui/src/ResourceBenchmark.tsx',
  'ui/src/probe.css',
];

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--destination' || !isAbsolute(args[1])) {
    throw new Error('Usage: node e2e/scripts/prepare-workspace-probe.mjs --destination ABSENT_ABSOLUTE_PATH');
  }
  // Resolve the existing parent only. Resolving the destination itself would
  // follow an existing symlink instead of letting exclusive mkdir reject it.
  const destination = join(await realpath(dirname(args[1])), basename(args[1]));
  const fixtureRoot = await lstat(fixture);
  if (fixtureRoot.isSymbolicLink() || !fixtureRoot.isDirectory()) {
    throw new Error('Fixture root must be a real directory');
  }
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const source = join(fixture, ...parts.slice(0, i));
      const stat = await lstat(source);
      if (stat.isSymbolicLink() || (i === parts.length ? !stat.isFile() : !stat.isDirectory())) {
        throw new Error(`Fixture source must not contain symlinks or special files: ${source}`);
      }
    }
  }
  // No recursive creation here: existing files, directories, and even dangling
  // symlinks all fail. Never remove or reuse any pre-existing destination.
  await mkdir(destination, { mode: 0o700 });
  for (const file of files) {
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(fixture, file), target, constants.COPYFILE_EXCL);
  }

  // Do not inherit repository redirections, injected Git config, templates, or
  // signing/hooks from the caller. Identity is scoped to each command only.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = devNull;
  const git = (...command) => execFileSync('git', [
    '-c', 'user.name=Omniview Workspace Probe',
    '-c', 'user.email=workspace-probe@omniview.dev',
    '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${devNull}`,
    '-C', destination,
    ...command,
  ], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--template=', '--initial-branch=main');
  git('add', '--', ...files);
  git('commit', '-m', 'Initialize safe workspace probe plugin');
  const ref = git('rev-parse', '--verify', 'HEAD');
  process.stdout.write(`${JSON.stringify({ source: await realpath(destination), ref, pluginID })}\n`);
}

main().catch((error) => {
  process.stderr.write(`prepare-workspace-probe: ${error.message}\n`);
  process.exitCode = 1;
});
