// What a bundle needs, read from its text before any of it runs. A `System.register` module states its dependencies in its first line
// (`System.register(["react", "./chunk.js"], …)`), so the host can refuse a bundle built for another host on proof (strategy R11: the gate reads
// facts from the artifact and refuses on a mismatch it can prove, never on a version it does not know). A refused bundle runs nothing: the old
// bundles inject their stylesheet when their script is evaluated, ahead of linking, and an unlayered sheet in the new shell beats every layer the kit declares.

const REGISTRATION = /System\.register\(\s*(?:(['"])(?:(?!\1).)*\1\s*,\s*)?\[([^\]]*)\]/;
const QUOTED = /(['"])((?:(?!\1).)*)\1/g;

/** The dependency list of the first registration in `source`, or undefined when the text registers nothing. */
export function readDependencies(source: string): readonly string[] | undefined {
  const match = REGISTRATION.exec(source);
  if (match === null) {
    return undefined;
  }

  return [...(match[2] ?? '').matchAll(QUOTED)].map((quoted) => quoted[2] ?? '');
}

/** A dependency on a file of the same plugin (a chunk): a path, not a name the host serves. */
const isLocal = (specifier: string): boolean => specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes('://');

/** The bare names `source` imports that `served` does not hold, in the order it imports them. Empty when it registers nothing: the loader decides then. */
export function unservedImports(source: string, served: readonly string[]): readonly string[] {
  return (readDependencies(source) ?? []).filter((specifier) => !isLocal(specifier) && !served.includes(specifier));
}
