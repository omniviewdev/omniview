import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plugin JavaScript runs in the host's realm and receives the modules in
 * `shared_dependencies.ts` unchanged: through the SystemJS import map in
 * production and through `window.__OMNIVIEW_SHARED__` in development. A
 * binding exported from them is a binding every plugin can call.
 *
 * The MCP relay is host-only. Its consent calls answer a pending agent
 * request and its client-setup call puts the bearer credential on the clipboard. The host's own
 * approval dialog and settings page import the binding by a path that is not
 * in the shared list.
 */
const RELAY_NAMES = [
  'McpRelayClient',
  'ResolveConfirmation',
  'ListPendingConfirmations',
  'CopyClientSetup',
] as const;

// The shared list itself cannot be imported here (its monaco entries do not
// resolve under vitest), so its text is read and each runtime entry it shares
// is loaded through the same alias the host build uses.
const runtimeModules: Record<string, () => Promise<Record<string, unknown>>> = {
  '@omniviewdev/runtime': async () => import('@omniviewdev/runtime'),
  '@omniviewdev/runtime/api': async () => import('@omniviewdev/runtime/api'),
  '@omniviewdev/runtime/runtime': async () => import('@omniviewdev/runtime/runtime'),
  '@omniviewdev/runtime/models': async () => import('@omniviewdev/runtime/models'),
};

const sharedList = fs.readFileSync(path.resolve(__dirname, 'shared_dependencies.ts'), 'utf8');
const sharedRuntimeSpecifiers = [...sharedList.matchAll(/^\s*'(@omniviewdev\/runtime(?:\/[a-z]+)?)': async \(\) => import\('\1'\),$/gm)]
  .map(match => match[1]);

const shimsDirectory = path.resolve(__dirname, '../../../../packages/omniviewdev-vite-plugin/shims');

/** Every name reachable from a module by its exports, and by the members of exported namespaces. */
const reachableNames = (module: Record<string, unknown>): string[] => {
  const names: string[] = [];
  for (const [name, value] of Object.entries(module)) {
    names.push(name);
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
      names.push(...Object.keys(value));
    }
  }

  return names;
};

describe('plugin-shared surface', () => {
  it('this test covers every runtime module the host shares with plugins', () => {
    expect(sharedRuntimeSpecifiers).toEqual(Object.keys(runtimeModules));
  });

  it.each(Object.keys(runtimeModules))('%s does not expose the MCP relay client or its consent and token calls', async (specifier) => {
    const names = reachableNames(await runtimeModules[specifier]());

    expect(RELAY_NAMES.filter(name => names.includes(name))).toEqual([]);
  });

  it('the generated @omniviewdev/runtime/api shim exports the module\'s names and no relay name', async () => {
    const shim = fs.readFileSync(path.join(shimsDirectory, '_omniviewdev__runtime__api.mjs'), 'utf8');
    const shimNames = [...shim.matchAll(/^export \{ binding\d+ as "([^"]+)" \};$/gm)].map(match => match[1]).sort();
    const moduleNames = Object.keys(await runtimeModules['@omniviewdev/runtime/api']()).sort();

    expect(RELAY_NAMES.filter(name => shimNames.includes(name))).toEqual([]);
    expect(shimNames, 'regenerate shims: pnpm --filter @omniviewdev/vite-plugin generate-shims').toEqual(moduleNames);
  });
});
