// The `plugin.yaml` of a fixture plugin, written by the build (`../build.mjs`, read by Node: this file holds nothing a type-stripping run cannot erase). The capabilities are what the host reads to know that the plugin has a
// backend (any capability but `ui` starts a process) and which of its controllers to start for it.

/**
 * The manifest of a plugin. `backend` is whether it has a process, and `served` the capabilities that process serves itself, written before the two that every plugin with a process has: the SDK serves `settings` with no code
 * of the plugin's, and `ui` is the bundle. A plugin with no process declares `ui` alone, whatever it is said to serve: nothing would serve it.
 */
export function manifestOf(id: string, name: string, backend: boolean, served: readonly string[] = []): string {
  const capabilities = backend ? [...served, 'settings', 'ui'] : ['ui'];
  return [
    `id: ${id}`,
    'version: 0.0.1',
    `name: ${name}`,
    'description: Fixture plugin of the new UI seam',
    'license: Apache-2.0',
    'author:',
    '  name: Omniview',
    'capabilities:',
    ...capabilities.map((capability) => `  - ${capability}`),
    '',
  ].join('\n');
}
