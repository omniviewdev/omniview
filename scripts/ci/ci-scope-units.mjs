// Which units of the kit probes a pull request's diff changes (N33): the part of scripts/ci/ci-scope.mjs that lets a pull request that changes only per-unit files run the full treatment (every negative control, both engines) of JUST
// those units, and the probes of every other unit in WebKit as a pull request does.
//
// A pull request that adds or edits a probe changes files that belong to that probe and to no other: its unit file (scripts/ci/probe-units/<probe>.mjs), its entry of the manifest (scripts/ci/probe-units.manifest.json) and of the
// layout record (scripts/ci/probe-shards.layout.json), the probe script a unit runs and the files only that script reads (its fixture). Everything else a diff changes is shared (the engine, the tables' schema, the harness a
// probe imports, the workflows, the scope code) and makes the run full, as before.
//
// FAIL CLOSED. `attribute` answers `{ ok: true, units, why }` only when EVERY file it is given is one of the kinds above and can be tied to the units that read it. Any other answer is `{ ok: false, file, reason }` and the run is full:
//   - a file that is not one of the kinds above (the caller passes only test infrastructure);
//   - a unit file that imports anything (it would carry a shared helper's change), or a path that is not `scripts/ci/probe-units/<name>.mjs`;
//   - a manifest or layout that does not parse, in the diff's two sides, or a change of the layout that is not a unit's seconds;
//   - a file of a probes directory that existed before and that no probe reads (who reads it is unknown), a file that was deleted (the same), and a file that more probes read than one (a shared helper: two when the file is a probe
//     script that a wrapper runs), or that a script (MAX_DEPENDENTS) of more than two others reads.
// What a unit that is NOT in the answer loses is only the controls and the second engine: its probe still runs in WebKit, as on every pull request. So the reading of "who reads this file" may over-include (it looks for the file's
// name in the text of every file a probe reaches); it must never under-include a file that a probe reaches by a path written out in a file of a probes directory, and the tests hold that.
import path from 'node:path';

/** The directories whose files a probe reads (the closure of a probe's script goes no further: a product file does not read a probe). */
export const PROBES_DIRECTORY = /(?:^|\/)probes\//;

export const UNIT_FILE = /^scripts\/ci\/probe-units\/[^/]+\.mjs$/;
export const MANIFEST = 'scripts/ci/probe-units.manifest.json';
export const LAYOUT = 'scripts/ci/probe-shards.layout.json';

/** A probe script that more than this many OTHER probe scripts read (a wrapper that runs it counts) is a shared file. */
export const MAX_DEPENDENTS = 2;

const EXTENSIONS = ['', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.json', '/index.mjs', '/index.js', '/index.ts', '/index.tsx'];
const SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`]([^'"`\n]+)['"`]/g;
const LITERAL = /['"`]([^'"`\n]*\.(?:mjs|cjs|js|ts|tsx|jsx|json|css|html))['"`]/g;
const IMPORTING = /(?:^|\n)\s*(?:import\s|export\s[^\n]*\sfrom\s)|\brequire\s*\(|\bimport\s*\(/;

/** The files of a probes directory that `file`'s text names by a path (an import, a string that is a path), resolved against the file's own directory and the repository. */
export function referencedBy(file, text, exists) {
  const found = new Set();
  const here = path.posix.dirname(file);
  const add = (candidate) => {
    const clean = path.posix.normalize(candidate);
    if (clean.startsWith('..') || path.posix.isAbsolute(clean)) return;
    for (const extension of EXTENSIONS) {
      const full = `${clean}${extension}`;
      if (PROBES_DIRECTORY.test(full) && exists(full)) found.add(full);
    }
  };
  for (const pattern of [SPECIFIER, LITERAL]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const written = match[1];
      add(path.posix.join(here, written));
      add(written);
    }
  }

  return found;
}

/**
 * The probe-directory files that a probe script reaches: itself and every file of a probes directory named by a path in it or in a file it reaches, with the text of each. A file of the product is not followed.
 * @returns {Map<string, string>} path to text
 */
export function closureOf(script, { read, exists }) {
  const reached = new Map();
  const queue = [script];
  while (queue.length > 0 && reached.size < 500) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    const text = read(file);
    if (text === null) continue;
    reached.set(file, text);
    for (const next of referencedBy(file, text, exists)) if (!reached.has(next)) queue.push(next);
  }

  return reached;
}

const jsonOf = (text) => {
  if (text === null) return {};
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const changedKeys = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));

/**
 * The units a diff changes, or why it cannot say.
 * @param {{ files: string[], units: {id: string, file: string, script: string}[], readHead: (file: string) => string | null, readBase: (file: string) => string | null }} input
 *   `files` the changed files that are test infrastructure; `units` the table of the head; `readHead` and `readBase` the text of a file in the pull request and in its base, null when it is not there.
 * @returns {{ ok: true, units: string[], why: {file: string, units: string[], what: string}[] } | { ok: false, file: string, reason: string }}
 */
export function attribute({ files, units, readHead, readBase }) {
  const exists = (file) => readHead(file) !== null;
  const scripts = [...new Set(units.map((unit) => unit.script))];
  const closures = new Map();
  const closure = (script) => {
    if (!closures.has(script)) closures.set(script, closureOf(script, { read: readHead, exists }));
    return closures.get(script);
  };
  const unitsOfScripts = (set) => units.filter((unit) => set.has(unit.script)).map((unit) => unit.id);
  const chosen = new Set();
  const why = [];
  const refuse = (file, reason) => ({ ok: false, file, reason });
  const take = (file, ids, what) => {
    for (const id of ids) chosen.add(id);
    why.push({ file, units: [...new Set(ids)], what });
  };

  /** The scripts that read `file`: its own when a unit runs it, and every script whose reach names it. */
  const readers = (file) => {
    const name = path.posix.basename(file);
    const set = new Set();
    for (const script of scripts) {
      if (script === file) set.add(script);
      else {
        const reached = closure(script);
        if (reached.has(file) || [...reached.values()].some((text) => text.includes(name))) set.add(script);
      }
    }

    return set;
  };

  /** A change of a probe script or of the file it reads: `{ ids }` or a refusal. */
  const ofProbeFile = (file) => {
    if (!exists(file)) return { refusal: 'a probe file that was deleted: who read it is not known' };
    const set = readers(file);
    if (set.size === 0) return readBase(file) === null ? { ids: [], what: 'a new file that no probe reads yet' } : { refusal: 'a file of a probes directory that no probe reads: who reads it is not known' };
    const isScript = scripts.includes(file);
    if (!isScript && set.size > 1) return { refusal: `a file ${set.size} probe scripts read (${[...set].map((script) => path.posix.basename(script)).join(', ')}): a shared helper` };
    if (isScript && set.size - 1 > MAX_DEPENDENTS) return { refusal: `a probe script that ${set.size - 1} other probe scripts read: a shared file` };
    return { ids: unitsOfScripts(set), what: isScript ? 'a probe script and the units that run it' : 'a file that one probe script reads' };
  };

  for (const file of files) {
    if (UNIT_FILE.test(file)) {
      const text = readHead(file);
      if (text === null) {
        take(file, [], 'a unit file that was removed (the manifest holds the floor)');
        continue;
      }
      if (IMPORTING.test(text)) return refuse(file, 'a unit file that imports another file (it could carry a shared change)');
      take(file, units.filter((unit) => unit.file === file).map((unit) => unit.id), 'a unit file: its units');
    } else if (file === MANIFEST) {
      const before = jsonOf(readBase(file));
      const after = jsonOf(readHead(file));
      if (before === undefined || after === undefined) return refuse(file, 'a manifest that does not read as an object, in the base or in the pull request');
      for (const key of changedKeys(before, after)) {
        take(file, unitsOfScripts(readers(key)), `the manifest's entry for ${key}`);
      }
    } else if (file === LAYOUT) {
      const before = jsonOf(readBase(file));
      const after = jsonOf(readHead(file));
      if (before === undefined || after === undefined) return refuse(file, 'a layout record that does not read as an object, in the base or in the pull request');
      const known = new Set(units.map((unit) => unit.id));
      for (const key of changedKeys(before, after)) {
        if (key === 'note') continue;
        if (key !== 'oldLayoutSeconds') return refuse(file, `the layout record's "${key}", which is not a unit's seconds`);
        const was = before[key] ?? {};
        const is = after[key] ?? {};
        if (typeof was !== 'object' || typeof is !== 'object') return refuse(file, 'a layout record whose seconds are not an object');
        for (const id of changedKeys(was, is)) {
          if (!known.has(id)) return refuse(file, `the layout record's seconds of "${id}", which is no unit of the table`);
          take(file, [id], `the layout record's seconds of the unit ${id}`);
        }
      }
    } else if (PROBES_DIRECTORY.test(file)) {
      const found = ofProbeFile(file);
      if (found.refusal !== undefined) return refuse(file, found.refusal);
      take(file, found.ids, found.what);
    } else {
      return refuse(file, 'a file that is not a unit, the manifest, the layout record or a file of a probes directory');
    }
  }

  return { ok: true, units: [...chosen].sort(), why };
}
