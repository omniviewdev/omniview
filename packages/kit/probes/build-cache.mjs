// One build, made once for everything that shares a directory (N27, docs/ui-next/status/N27.md). The probes that build their own fixtures (the shell's, the Settings page's, the Plugins page's, the list page's, the Logs strip's) used to
// build them for every process, and a negative control is a process: each control built the same fixtures again. The shard runner (scripts/ci/probe-shards.mjs) now gives every process of a shard the same BUILD_CACHE, a directory
// named by the hash of what a build reads (scripts/ci/probe-builds.mjs); the first process that needs a build makes it there and the others read it.
//
//   const directory = sharedBuild({ kind: 'shell-fixtures', mode: 'production', build: (out, env) => execFileSync('node', [script, out, 'production'], { cwd: repo, env: { ...env, OMNIVIEW_UI: 'next', NODE_ENV: 'production' }, stdio: 'pipe' }) });
//
//   kind   what is built: one word for one recipe (the entries it builds, the script that builds them). Two kinds never share a directory, however alike their modes: the shell's five fixture entries and the Settings page's one are
//          both a `production` build and are not the same files.
//   mode   production or development.
//   build  makes the build into the directory it is given. It is given the environment to build with, which is the process's own less the control it runs (NEGATIVE_CONTROL, ASSERTION_OFF): a build is the same for every control,
//          which is what makes it safe to share, and a build that inherited the control could be different for one. A control that plants its fault in the SOURCE or at build time is not safe to share: its unit says
//          `plants: 'build'` (scripts/ci/probe-units), the runner gives it no shared build, and the probe passes the fault to the build itself, in a variable of its own, where a reader of the probe sees it.
//
// Sound by construction: a build is made in a directory beside its place and moved there whole (`<cache>/<kind>/<mode>` exists only when a build finished, so a build that failed or was killed is never read), a process that finds one
// reads it and does not build, and a process that builds while another publishes keeps the first's. With no BUILD_CACHE (a person running one probe) the build is made into a directory of its own, as it always was.
//
// Every build prints one line, `probe-build: <kind>/<mode> built in <s> s (shared|not shared)` or `probe-build: <kind>/<mode> reused`, which the shard runner counts (scripts/ci/probe-builds.mjs).
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The variables that name the control a process runs: a build never sees them. */
export const CONTROL_VARIABLES = ['NEGATIVE_CONTROL', 'ASSERTION_OFF'];

/** `env` less the variables of the control (a new object: the caller's is not changed). */
export function withoutControl(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !CONTROL_VARIABLES.includes(name)));
}

const seconds = (started) => ((performance.now() - started) / 1000).toFixed(1);

/** Where the build goes: the shared place and the directory to build in beside it, or a directory of its own when nothing is shared. */
function place({ kind, mode, env }) {
  const cache = env.BUILD_CACHE;
  if (cache === undefined || cache === '') return { shared: false, final: undefined, work: mkdtempSync(path.join(os.tmpdir(), `${kind}-${mode}-`)) };
  const final = path.join(cache, kind, mode);
  mkdirSync(path.dirname(final), { recursive: true });
  const work = `${final}.partial-${process.pid}-${Date.now()}`;
  mkdirSync(work, { recursive: true });
  return { shared: true, final, work };
}

/** Moves a finished build to its place. False when another process published its own first: ours is thrown away and theirs is the one to read. */
function publish({ final, work }) {
  try {
    renameSync(work, final);
    return true;
  } catch (error) {
    if (existsSync(final)) {
      rmSync(work, { recursive: true, force: true });
      return false;
    }
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

/** The directory of the build `kind`/`mode`: built by `build(directory, env)` when no process has built it yet, read otherwise. */
export function sharedBuild({ kind, mode, build, env = process.env, log = (line) => console.log(line) }) {
  const name = `${kind}/${mode}`;
  const asked = env.BUILD_CACHE === undefined || env.BUILD_CACHE === '' ? undefined : path.join(env.BUILD_CACHE, kind, mode);
  if (asked !== undefined && existsSync(asked)) {
    log(`probe-build: ${name} reused`);
    return asked;
  }
  const where = place({ kind, mode, env });
  const started = performance.now();
  try {
    build(where.work, withoutControl(env));
  } catch (error) {
    if (where.shared) rmSync(where.work, { recursive: true, force: true });
    throw error;
  }
  if (!where.shared) {
    log(`probe-build: ${name} built in ${seconds(started)} s (not shared)`);
    return where.work;
  }
  if (publish(where)) log(`probe-build: ${name} built in ${seconds(started)} s (shared)`);
  else log(`probe-build: ${name} reused`);
  return where.final;
}
