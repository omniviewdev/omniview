// Which negative controls of the kit probes a change must run (N25), and why. Pure functions: no file, no Git, no environment but what they are given (scripts/ci/probe-shards.mjs reads those and calls them).
//
// A control proves that its probe CAN fail: it plants one fault in the page and the probe must notice. That proof is worth re-making when the probe, its harness or the code it checks changed, and not when
// something else did. So on a pull request:
//
//   - every PROBE runs, always (this step does not gate the probes themselves);
//   - a CONTROL unit runs when a changed path matches one of the globs declared next to it (scripts/ci/probe-units/<probe>.mjs: its probe, the files only that probe reads, and the source directories it exercises),
//     or when its declaration file changed (it is the unit that was added or changed);
//   - EVERY control runs when the change touches what every control depends on (EVERYTHING below: the shared harness, scripts/ci/**, the kit's tokens, CSS and primitives, the package manifests and the lockfile, the
//     probe workflow and the CI image), or a path outside the new UI and its documentation (its class is unknown here: changes.mjs calls it "other"), or a path that is not plain.
//
// On anything else the answer is every control: a push to main (the only full run of a commit), the nightly run, a dispatch, a merge queue, a re-run of a pull request, an event or an attempt number that cannot be
// read, a diff that cannot be read and a diff with no path. THE SELECTION ERRS ON THE SIDE OF RUNNING: what it cannot classify is a reason to run, never a reason to skip.
//
// What this lets through, stated plainly: a control that stops proving anything because of a change OUTSIDE the globs declared for it (a primitive of the kit, a file only a fixture's import reaches) is not
// seen on the pull request. It is seen on main and in the nightly run, which run every control, and fails there.
import { pathArea } from './changes.mjs';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Globs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** The globs a glob with `{a,b}` stands for, one for each alternative (an alternative may hold a `/`; braces do not nest). Without braces, the glob itself. */
function expandBraces(glob) {
  const open = glob.indexOf('{');
  if (open === -1) {
    if (glob.includes('}')) throw new Error(`the glob ${JSON.stringify(glob)} has a "}" with no "{"`);
    return [glob];
  }
  const close = glob.indexOf('}', open);
  if (close === -1) throw new Error(`the glob ${JSON.stringify(glob)} has a "{" with no "}"`);
  const inner = glob.slice(open + 1, close);
  if (inner.includes('{')) throw new Error(`the glob ${JSON.stringify(glob)} nests braces: write the alternatives out`);
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return inner.split(',').flatMap((alternative) => expandBraces(`${head}${alternative}${tail}`));
}

/** One piece of a glob (no `**`, no braces): `*` is any run of characters inside a segment, `?` is one; everything else is literal. */
function piece(text) {
  let out = '';
  for (const char of text) out += char === '*' ? '[^/]*' : char === '?' ? '[^/]' : escapeRegExp(char);
  return out;
}

/** The regular expression source of a glob without braces. */
function segmentsToSource(glob) {
  if (glob.startsWith('/') || glob.startsWith('./') || glob.endsWith('/') || glob.includes('//') || glob.includes('\\')) throw new Error(`the glob ${JSON.stringify(glob)} is not a repository-relative path with "/" (no leading "/" or "./", no "\\", no empty segment)`);
  if (/[[\]]/.test(glob)) throw new Error(`the glob ${JSON.stringify(glob)} has a bracket: character classes are not supported, write the alternatives as {a,b}`);
  const segments = glob.split('/');
  if (segments.includes('..') || segments.includes('.')) throw new Error(`the glob ${JSON.stringify(glob)} has a "." or ".." segment`);
  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment.includes('**') && segment !== '**') throw new Error(`the glob ${JSON.stringify(glob)} has "**" inside a segment: it is a whole segment`);
    if (segment === '**') {
      // `dir/**` ends the glob: one or more segments. `a/**/b`: zero or more directories.
      source += last ? '.+' : '(?:[^/]+/)*';
      return;
    }
    source += piece(segment);
    if (!last) source += '/';
  });
  return source;
}

/**
 * The regular expression of a glob over a repository-relative path with `/` (the paths Git prints): `*` inside one segment, `?` one character, `**` as a whole segment for any number of segments (`dir/**` is
 * everything below `dir`, not `dir`; `a/**` + `/b` allows none), `{a,b}` either (an alternative may hold a `/`; no nesting). Case-sensitive. A glob that cannot be read is an error: a typo must fail the table, not match
 * nothing.
 */
export function globToRegExp(glob) {
  if (typeof glob !== 'string' || glob === '') throw new Error(`a glob is a non-empty string, not ${JSON.stringify(glob)}`);
  return new RegExp(`^(?:${expandBraces(glob).map(segmentsToSource).join('|')})$`);
}

const compiled = new Map();
/** The alternatives a glob stands for (the glob itself without braces), each with its regular expression, compiled once. */
function alternativesOf(glob) {
  let list = compiled.get(glob);
  if (list === undefined) {
    if (typeof glob !== 'string' || glob === '') throw new Error(`a glob is a non-empty string, not ${JSON.stringify(glob)}`);
    list = expandBraces(glob).map((alternative) => ({ alternative, expression: new RegExp(`^(?:${segmentsToSource(alternative)})$`) }));
    compiled.set(glob, list);
  }
  return list;
}

/** The alternative of the glob that matches the path (the glob without its braces, so that a reason reads as a path), or null. */
export function whichMatch(glob, file) {
  return alternativesOf(glob).find((entry) => entry.expression.test(file))?.alternative ?? null;
}

/** Does the glob match the path. */
export const matches = (glob, file) => whichMatch(glob, file) !== null;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What every control depends on
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The files every probe imports or runs through, and so every control: the kit's probe library, the static server, the mock's own screen helper, the shell probes' harness and the build of the fixtures it runs.
 * (The page probes' library and build are those two probes' own, and have no control.) The test of the table fails when another file of the probe directories is imported by probes of two families and is in no unit's
 * globs.
 */
export const SHARED_HARNESS = [
  'packages/kit/probes/probe-lib.mjs',
  'packages/kit/probes/serve.mjs',
  'packages/kit/probes/mock-screen.mjs',
  'ui-next/shell/probes/harness.mjs',
  'ui-next/shell/probes/build-fixture.mjs',
];

/**
 * What every control runs for. The order is the order of the reasons given. `scripts/ci/probe-units/` is not here: a unit's declaration selects only the controls it declares (the test of the table says so).
 */
export const EVERYTHING = [
  ...SHARED_HARNESS.map((glob) => ({ glob, why: 'the shared harness of the probes' })),
  { glob: 'scripts/ci/**', why: 'the CI scripts and their tests' },
  { glob: '.github/workflows/ui-next-kit-probes.yml', why: 'the probe workflow' },
  { glob: '.github/ci/**', why: 'the CI image the probes run in' },
  { glob: '**/package.json', why: 'a package manifest' },
  { glob: 'pnpm-lock.yaml', why: 'the lockfile' },
  { glob: 'pnpm-workspace.yaml', why: 'the workspace file' },
  { glob: '.npmrc', why: 'the package manager settings' },
  { glob: '.tool-versions', why: 'the toolchain pins' },
  { glob: 'packages/kit/tokens/**', why: "the kit's tokens" },
  { glob: 'packages/kit/src/generated/tokens.css', why: "the kit's generated tokens" },
  { glob: 'packages/kit/src/generated/tokenNames.ts', why: "the kit's generated token names" },
  { glob: 'packages/kit/src/styles/**', why: "the kit's layers, base styles and fonts" },
  { glob: 'packages/kit/src/theme/**', why: "the kit's theme provider" },
  { glob: 'packages/kit/fonts/**', why: "the kit's font files" },
  { glob: 'packages/kit/src/components/Text/**', why: "the kit's text primitive" },
  { glob: 'packages/kit/src/components/Stack/**', why: "the kit's layout primitive" },
  { glob: 'packages/kit/src/shared/**', why: "what the kit's parts share" },
  { glob: 'packages/kit/vite.config.ts', why: "the kit's build" },
  { glob: 'packages/kit/tsconfig*.json', why: "the kit's build" },
  { glob: 'packages/kit/scripts/**', why: "the kit's build checks" },
];

/** Not read by any probe: a test of vitest, Markdown anywhere, and the kit's API reports (Markdown). A change to one alone selects nothing. Checked after EVERYTHING, so a test inside what every control depends on still runs them all. */
const NOT_READ = [/\.(?:test|spec)\.[cm]?[jt]sx?$/, /\.md$/];

const UNITS_DIRECTORY = 'scripts/ci/probe-units/';

/** A path as a plain repository-relative one: no control character, no backslash, no empty, `.` or `..` segment, no leading or trailing slash. */
export const isPlainPath = (file) => typeof file === 'string' && file !== '' && !/[\u0000-\u001f\u007f\u2028\u2029\\]/.test(file) && !file.startsWith('/') && !file.endsWith('/') && file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

/** A path as one line of a log or a Markdown code span: nothing in it can end the line, start a workflow command or end the span. */
export function show(file) {
  const clean = String(file).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '?').replaceAll('`', "'");
  return clean.length > 200 ? `${clean.slice(0, 200)}...` : clean;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const FULL_REASON = {
  push: 'a push to main: the only full run of that commit',
  schedule: 'the nightly run',
  workflow_dispatch: 'a dispatch by hand',
  merge_group: 'a merge queue run',
};

/** `{ mode: 'by-change' | 'full', reason }`: only a pull request on its first attempt is selected by what it changes. */
export function contextOf({ event, attempt }) {
  if (event !== 'pull_request') {
    return { mode: 'full', reason: FULL_REASON[event] ?? `the event ${JSON.stringify(event ?? null)} is not a pull request` };
  }
  const number = typeof attempt === 'number' ? attempt : /^\d+$/.test(String(attempt ?? '')) ? Number(attempt) : Number.NaN;
  if (!Number.isInteger(number) || number < 1) return { mode: 'full', reason: `the run attempt ${JSON.stringify(attempt ?? null)} cannot be read` };
  if (number > 1) return { mode: 'full', reason: `a re-run (attempt ${number}) of a pull request` };
  return { mode: 'by-change', reason: 'a pull request' };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const isControls = (unit) => unit.controls !== undefined;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The globs a unit is selected by: the ones declared next to it. (The file that declares it is matched on its own, below, so that it selects only the controls it declares.) A unit with none is an error of the table. */
function globsOf(unit) {
  if (!Array.isArray(unit.paths) || unit.paths.length === 0) throw new Error(`the unit "${unit.id}" declares no paths: a control unit with no globs would never be selected`);
  for (const glob of unit.paths) {
    try {
      globToRegExp(glob);
    } catch (error) {
      throw new Error(`the unit "${unit.id}" has a glob that cannot be read: ${error.message}`);
    }
  }
  return unit.paths;
}

/** Why a path runs every control, or null: the first of EVERYTHING that matches it. */
function everythingWhy(file) {
  for (const entry of EVERYTHING) if (matches(entry.glob, file)) return entry.why;
  return null;
}

/**
 * The controls a change runs.
 *   units    the table's units, each `{ id, name, script, controls?, seconds, paths, file }`
 *   changed  the changed paths as Git spells them, or null when they could not be read
 *   context  `contextOf(...)`
 * Returns `{ mode, reason, everything, forced, ignored, undeclared, skippedSeconds, units }`: `units` has, for each unit in the order given, `{ id, name, controls, seconds, run, why }`; `forced` lists the
 * paths that made it everything (`{ path, why }`), `ignored` the paths no probe reads and `undeclared` the paths of the new UI that no unit declares.
 */
export function selectControls({ units, changed, context }) {
  const declared = units.map((unit) => ({ unit, globs: isControls(unit) ? globsOf(unit) : [] }));
  const result = { mode: context.mode, reason: context.reason, everything: false, forced: [], ignored: [], undeclared: [], skippedSeconds: 0, units: [] };
  const reached = new Map();

  if (context.mode === 'full') {
    result.everything = true;
  } else if (!Array.isArray(changed)) {
    result.mode = 'full';
    result.reason = 'the changed paths could not be read: nothing proves that a control can be skipped';
    result.everything = true;
  } else if (changed.length === 0) {
    result.mode = 'full';
    result.reason = 'no changed path: nothing proves that a control can be skipped';
    result.everything = true;
  } else {
    for (const file of new Set(changed)) {
      if (!isPlainPath(file)) {
        result.forced.push({ path: show(file), why: 'a path that is not plain (a control character, a backslash, a dot segment): it is not classified' });
        continue;
      }
      if (file.startsWith(UNITS_DIRECTORY)) {
        // A unit's declaration: it selects the controls it declares, and no others.
        const owners = declared.filter((entry) => entry.unit.file === file && isControls(entry.unit));
        for (const entry of owners) reached.set(entry.unit.id, [...(reached.get(entry.unit.id) ?? []), { path: file, glob: file }]);
        if (!declared.some((entry) => entry.unit.file === file)) result.undeclared.push(file);
        continue;
      }
      const forced = everythingWhy(file);
      if (forced !== null) {
        result.forced.push({ path: show(file), why: forced });
        continue;
      }
      const area = pathArea(file);
      if (area === 'docs') {
        result.ignored.push(file);
        continue;
      }
      if (area === 'other') {
        result.forced.push({ path: show(file), why: 'a path outside the new UI and its documentation: its class is unknown here' });
        continue;
      }
      if (NOT_READ.some((pattern) => pattern.test(file))) {
        result.ignored.push(file);
        continue;
      }
      let any = false;
      for (const entry of declared) {
        let glob = null;
        for (const candidate of entry.globs) {
          glob = whichMatch(candidate, file);
          if (glob !== null) break;
        }
        if (glob === null) continue;
        any = true;
        reached.set(entry.unit.id, [...(reached.get(entry.unit.id) ?? []), { path: file, glob }]);
      }
      if (!any) result.undeclared.push(file);
    }
    result.everything = result.forced.length > 0;
  }

  for (const { unit } of declared) {
    const entry = { id: unit.id, name: unit.name, controls: isControls(unit), seconds: unit.seconds, run: true, why: '' };
    if (!entry.controls) {
      entry.why = 'a probe always runs';
    } else if (context.mode === 'full' || result.mode === 'full') {
      entry.why = `full run: ${result.reason}`;
    } else if (result.everything) {
      const first = result.forced[0];
      entry.why = `${first.path} (${first.why})${result.forced.length > 1 ? ` and ${plural(result.forced.length - 1, 'more path')}` : ''}: every control runs`;
    } else if (reached.has(unit.id)) {
      const hits = reached.get(unit.id);
      entry.why = `changed: ${show(hits[0].path)} matches ${hits[0].glob}${hits.length > 1 ? ` and ${plural(hits.length - 1, 'more path')}` : ''}`;
    } else {
      entry.run = false;
      entry.why = 'no changed path matches its paths';
      result.skippedSeconds += unit.seconds ?? 0;
    }
    result.units.push(entry);
  }
  return result;
}
