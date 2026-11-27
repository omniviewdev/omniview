// The native window accepts the same settings targets as the legacy shell. Keep the plugin's opaque id whole.
export const pluginPageId = (id: string): string => `plugin/${id}`;

/** The page a target names, or `undefined` when it names none. */
export function pageOfTarget(target: string): string | undefined {
  const query = target.split('#', 1)[0]?.split('?', 2)[1];
  if (query === undefined) {
    return undefined;
  }

  const params = new URLSearchParams(query);
  const plugin = params.get('section') === 'plugins';
  const id = params.get(plugin ? 'plugin' : 'category');
  return id === null || id === '' || id.length > 256 ? undefined : plugin ? pluginPageId(id) : id;
}
