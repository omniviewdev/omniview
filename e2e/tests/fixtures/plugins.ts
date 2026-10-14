/**
 * A plugin as PluginManager.ListPlugins returns it. It is reported as failed,
 * so the app lists it without trying to load a UI bundle that does not exist.
 */
export function fakePlugin(n: number, overrides: Record<string, unknown> = {}) {
  const id = `e2e-plugin-${n}`;
  return {
    id,
    metadata: {
      id,
      name: `E2E Plugin ${n}`,
      version: '0.0.1',
      icon: 'LuBox',
      description: `Fake plugin ${n} for end-to-end tests`,
      capabilities: ['ui'],
    },
    phase: 'Failed',
    enabled: true,
    devMode: false,
    capabilities: ['ui'],
    lastError: 'e2e fake plugin',
    ...overrides,
  };
}
