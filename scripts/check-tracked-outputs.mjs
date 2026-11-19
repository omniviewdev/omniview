// The build outputs that live in the tree, checked first so that a mistake is one clear line and not a Go build that fails minutes in.
//
//   node scripts/check-tracked-outputs.mjs [--root <repository>] [--base <ref>]     exit 0 when the tree is right, 1 with one line per problem
//
// `--base <ref>` is the change under review: what the working tree has changed since the merge base of <ref> and HEAD. The workflow passes `HEAD^1`, the base of the merge commit
// a pull request is checked out as (the job fetches two commits for it); on a developer's machine `--base origin/main` is the same question.
//
// What it protects, and why:
//
//   dist/.gitkeep             MUST be in the tree and on disk. main.go embeds `all:dist` (main.go:92), and `go build` refuses an embed pattern that matches no file. `dist/` is the frontend
//                             build's output and is ignored (.gitignore: `dist`, `!dist/.gitkeep`), so this is the one tracked file of the directory, and every frontend build deletes it
//                             (docs/ui-next/AGENTS.md, "Traps"): `git add -A` or `git commit -a` after a build commits the deletion and the Go build fails on `all:dist`.
//   dist/ (anything else)     MUST NOT be tracked. It is the output of the flavour built last (building one flavour replaces the other): a tracked file there is a build output that was
//                             force-added, and it would ship in the next build.
//   build/darwin/icons.icns   written by `task common:generate:icons` (build/Taskfile.yml:55-64, `wails3 generate icons -input appicon.png`), which every desktop build runs again, so
//   build/windows/icon.ico    a local build can rewrite them byte for byte differently. They change only in a change that also changes their input, build/appicon.png.
//
// Not protected on purpose: build/darwin/Info.plist and Info.dev.plist, build/windows/info.json, wails.exe.manifest and installer/*, build/linux/nfpm/nfpm.yaml and desktop. `wails3 update
// build-assets` wrote them once from build/config.yml and they have been edited by hand since (Info.plist: 7 commits, one of them with config.yml), so a change to one is a reviewed edit,
// not a side effect of a build.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const KEEP = 'dist/.gitkeep';

/** Outputs of a generator, each with the input it is made from: the output may change only in a change that changes the input. */
export const GENERATED = [
  { output: 'build/darwin/icons.icns', input: 'build/appicon.png', generator: '`task common:generate:icons` (build/Taskfile.yml:55-64)' },
  { output: 'build/windows/icon.ico', input: 'build/appicon.png', generator: '`task common:generate:icons` (build/Taskfile.yml:55-64)' },
];

/**
 * The problems of a tree, one sentence each. `tracked` is every tracked path, `present` whether `dist/.gitkeep` is on disk, `changed` the paths the change under review touches
 * (empty when there is no change under review: only the tree is checked).
 */
export function checkOutputs({ tracked, present, changed = [] }) {
  const problems = [];
  const trackedSet = new Set(tracked);
  if (!trackedSet.has(KEEP)) {
    problems.push(
      `${KEEP} is not in the tree. main.go embeds \`all:dist\` and \`go build\` fails when that pattern matches no file. A frontend build deletes it: restore it with \`git checkout -- ${KEEP}\` and do not commit its deletion.`,
    );
  } else if (!present) {
    problems.push(`${KEEP} is tracked but missing from the working tree (a frontend build deletes it): restore it with \`git checkout -- ${KEEP}\` before the Go build, and do not commit its deletion.`);
  }

  for (const file of tracked) {
    if (file.startsWith('dist/') && file !== KEEP) {
      problems.push(`${file} is tracked, and it is a frontend build output (dist/ is ignored: it holds the flavour built last). Remove it from the index with \`git rm --cached ${file}\`.`);
    }
  }

  const changedSet = new Set(changed);
  for (const { output, input, generator } of GENERATED) {
    if (changedSet.has(output) && !changedSet.has(input)) {
      problems.push(`${output} changed without ${input}: it is the output of ${generator}, which every desktop build runs again, so a local build rewrites it. Restore it with \`git checkout origin/main -- ${output}\`, or change ${input} too.`);
    }
  }

  return problems;
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${root}: ${(result.stderr || result.error?.message || '').trim()}`);
  }
  return result.stdout;
}

const lines = (output) => output.split('\0').filter((line) => line !== '');

/** Reads the tree of `root` and, with `base`, the paths changed since the merge base of `base` and HEAD. */
export function readTree(root, base) {
  const tracked = lines(git(root, ['ls-files', '-z']));
  const present = existsSync(path.join(root, KEEP));
  let changed = [];
  if (base !== undefined) {
    let mergeBase;
    try {
      mergeBase = git(root, ['merge-base', base, 'HEAD']).trim();
    } catch (error) {
      throw new Error(`cannot read the base ${base}: fetch it (the workflow's checkout needs fetch-depth: 2 for HEAD^1). ${error.message}`);
    }
    changed = lines(git(root, ['diff', '--name-only', '-z', mergeBase, 'HEAD']));
  }
  return { tracked, present, changed };
}

export function main(argv = process.argv.slice(2)) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let base;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) {
      root = path.resolve(argv[(i += 1)]);
    } else if (argv[i] === '--base' && argv[i + 1] !== undefined) {
      base = argv[(i += 1)];
    } else {
      console.error('usage: node scripts/check-tracked-outputs.mjs [--root <repository>] [--base <ref>]');
      return 2;
    }
  }

  let problems;
  try {
    problems = checkOutputs(readTree(root, base));
  } catch (error) {
    console.error(`check-tracked-outputs: ${error.message}`);
    return 1;
  }

  for (const problem of problems) {
    console.error(`check-tracked-outputs: ${problem}`);
  }
  if (problems.length === 0) {
    console.log(`check-tracked-outputs: ok (${KEEP} is in the tree; no build output is tracked or changed by hand)`);
  }
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
