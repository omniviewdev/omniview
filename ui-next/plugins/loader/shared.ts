import type { ElementType, Key } from 'react';
import type { SharedSpecifierV1 } from './specifiers';

// How the host serves each shared module (`specifiers.ts`): a function that imports the host's OWN instance on first use. A bundler keeps one
// copy of a module that is both imported statically and dynamically, so a plugin and the shell render with the same React and the same kit. The
// registration evaluates nothing: a name's loader runs when a plugin first imports it (docs/ui-next/optimisations.md HSH-7: do not load the list eagerly).
type Loader = () => Promise<Record<string, unknown>>;

type JsxFactory = (type: ElementType, props: unknown, key?: Key) => unknown;
type JsxRuntime = { readonly jsx: JsxFactory } & Record<string, unknown>;

/**
 * The development JSX runtime a development server's modules import. A production build may replace `react/jsx-dev-runtime` with the production
 * runtime, which has no `jsxDEV`; the same function is made from `jsx` then (the old list does the same, ui/features/plugins/api/shared_dependencies.ts:11-26).
 */
async function jsxDevRuntime(): Promise<Record<string, unknown>> {
  const development: Record<string, unknown> = await import('react/jsx-dev-runtime');
  if (typeof development.jsxDEV === 'function') {
    return development;
  }

  const production: JsxRuntime = await import('react/jsx-runtime');
  const jsxDEV: JsxFactory = (type, props, key) => (key === undefined ? production.jsx(type, props) : production.jsx(type, Object.assign({}, props, { key })));
  return { ...production, jsxDEV };
}

export const SHARED_V1: Readonly<Record<SharedSpecifierV1, Loader>> = {
  react: async () => import('react'),
  'react/jsx-runtime': async () => import('react/jsx-runtime'),
  'react/compiler-runtime': async () => import('react/compiler-runtime'),
  'react/jsx-dev-runtime': jsxDevRuntime,
  '@omniviewdev/kit': async () => import('@omniviewdev/kit'),
};

/** The id a shared name has in the SystemJS registry. A URL-shaped id keeps it from being read as a bare specifier. */
export const sharedId = (specifier: string): string => `shared://${specifier}`;

/** What the loader needs of the registry: named registration and an import map. */
export type SharedRegistry = Pick<typeof System, 'register' | 'addImportMap'>;

const registered = new WeakSet<Record<string, unknown>>();

/** Registers every shared name in `registry` and maps the bare specifiers to them. Once per registry. */
export function registerShared(registry: SharedRegistry, shared: Readonly<Record<string, Loader>> = SHARED_V1): void {
  if (registered.has(registry)) {
    return;
  }

  registered.add(registry);
  const imports: Record<string, string> = {};
  for (const [specifier, load] of Object.entries(shared)) {
    const id = sharedId(specifier);
    registry.register(id, [], (exportModule) => ({
      execute: async () => {
        exportModule(await load());
      },
    }));
    imports[specifier] = id;
  }

  registry.addImportMap({ imports });
}
