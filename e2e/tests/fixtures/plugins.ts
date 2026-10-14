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

/** A marketplace listing as PluginManager.ListAvailablePlugins returns it. */
export function fakeListing(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id.replace(/(^|-)(\w)/g, (_, sep: string, c: string) => `${sep ? ' ' : ''}${c.toUpperCase()}`),
    description: `Marketplace listing for ${id}`,
    icon_url: '',
    category: 'tools',
    tags: [],
    license: 'MIT',
    official: false,
    featured: false,
    download_count: 0,
    average_rating: 0,
    review_count: 0,
    repository: '',
    url: '',
    publisher_name: 'e2e',
    installed: false,
    installed_version: '',
    latest_version: '1.2.3',
    update_available: false,
    ...overrides,
  };
}
