// The modules the host shares with a plugin's new-UI bundle at run time: the ABI of contract v1, as names. A bundle's build marks exactly these
// external, so the plugin renders with the host's one React and one kit (a copy of either breaks hooks and context), and the host refuses a bundle
// that imports anything else before it runs a line of it (`preflight.ts`).
//
// This file imports nothing, on purpose: the build of a plugin bundle (and the fixture's) reads the list from here with Node, and `shared.ts` holds the
// loaders that serve each name and is typed against this list, so the two cannot drift.
//
// Not here, deliberately: the old shell's other 30 names (`@omniviewdev/base-ui`, `ai-ui`, `editors`, `react-router`, `react-dom`, Monaco, the runtime's
// whole barrel `@omniviewdev/runtime`, and its raw `/api`, `/runtime` and `/models` entries). The new shell does not carry the old libraries (strategy R3,
// R4), so a bundle that imports one cannot run in it and must be refused by name. The runtime joins as its curated entry `@omniviewdev/runtime/ui/v1`
// (packages/omniviewdev-runtime/src/ui/v1.ts: ten functions and their types, API report `api/ui-v1.api.md`): sharing the whole barrel instead costs the
// new build a 1.88 MB chunk with the old UI library in it (docs/ui-next/slices/n19-plugin-seam.md, 1.2).
export const SHARED_SPECIFIERS_V1 = [
  'react',
  'react/jsx-runtime',
  // The React Compiler's runtime: every first-party plugin build compiles with it, so its output imports this.
  'react/compiler-runtime',
  // Imported by a development server's modules: Vite's React transform emits the development JSX runtime in `serve`.
  'react/jsx-dev-runtime',
  '@omniviewdev/kit',
  // The runtime's data layer for a plugin: the hooks that read connections and resources, and the helpers to read what they return.
  '@omniviewdev/runtime/ui/v1',
] as const;

export type SharedSpecifierV1 = (typeof SHARED_SPECIFIERS_V1)[number];
