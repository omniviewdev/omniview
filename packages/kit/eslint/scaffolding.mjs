/*
 * The one definition of "plugin scaffolding in the host" (decision A13).
 * Owner rule: the host and the kit are plugin-agnostic: no plugin-specific code or vocabulary outside a marked
 * scaffolding directory. The rule `kit/scaffold-boundary`, its wiring, and the vocabulary scan all read this file.
 */
import path from 'node:path';

/** The repository root (this file is `packages/kit/eslint/scaffolding.mjs`). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Directories of plugin code that live in the host only as scaffolding. They move into the plugin repo and are deleted here. */
export const PLUGIN_CODE = [
  'ui-next/k8s', // Data layer of the Pods list (the Kubernetes plugin's reads); moves to the Kubernetes plugin repo (tracker N19).
  'ui-next/pods', // The Pods page composition (plugin UI, the other half of the same scaffolding); moves to the plugin repo (N19).
];

/** Directories exempt from the vocabulary scan: the plugin code, and the slice's real-cluster Playwright check (may not exist yet). */
export const SCAFFOLDING = [...PLUGIN_CODE, 'ui-next/e2e'];

/**
 * What a plugin's bundle leaves external and takes from the host at run time: the shared list of contract v1 (`ui-next/plugins/loader/specifiers.ts`, which
 * `guards.test.mjs` compares this with). The runtime comes through its curated entry only (its main barrel holds the previous UI library), the kit through its
 * root entry only (its stylesheet is the host's: loaded once, it declares the layer order). A bundle that imports another module of this repository's packages
 * is refused by the loader before it runs, so scaffolding written to move into a plugin may not import one either.
 */
export const PLUGIN_SURFACE = ['react', 'react/jsx-runtime', 'react/compiler-runtime', '@omniviewdev/kit', '@omniviewdev/runtime/ui/v1'];

/** The token written in the source comments that mark scaffolding (tracker row N19). */
export const MARKER = 'SCAFFOLDING(N19)';

/** Whole words that name a plugin's domain. Bare "cluster" is ordinary UI English (a cluster of items), so it is NOT matched. */
export const FORBIDDEN_VOCABULARY = /\b(?:pods?|namespaces?|kubectl|kubernetes|k8s|kubeconfig|kube)\b/gi;

const toPosix = (value) => value.split(path.sep).join('/');

/** True when `relative` (posix, repo-relative) is `dir` or inside it. */
export function isInside(relative, dir) {
  return relative === dir || relative.startsWith(`${dir}/`);
}

export const isPluginCode = (relative) => PLUGIN_CODE.some((dir) => isInside(relative, dir));
export const isScaffolding = (relative) => SCAFFOLDING.some((dir) => isInside(relative, dir));

/** Repo-relative posix path of an absolute path, or undefined when it lies outside the repository. */
export function repoRelative(absolute, root = REPO_ROOT) {
  const relative = toPosix(path.relative(root, absolute));
  return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : relative;
}

/** 'kit' | 'shell' (host: under ui-next/ and not scaffolding) | 'plugin-code' | 'other'. */
export function classify(relative) {
  if (isInside(relative, 'packages/kit')) return 'kit';
  if (isPluginCode(relative)) return 'plugin-code';
  if (isInside(relative, 'ui-next') && !isScaffolding(relative)) return 'shell';
  return 'other';
}
