/** Backend answers every screen needs: settings, plugin metadata, connections. */
import { handleAll } from '../harness/backend';

export const BENCH_CONNECTION_ID = 'bench';

export function installDefaultFixtures(): void {
  handleAll({
    'internal/settings/servicewrapper.Values': () => ({}),
    'internal/settings/servicewrapper.ListSettings': () => ({}),
    'internal/settings/servicewrapper.GetCategories': () => [],
    'plugin/settings/servicewrapper.PluginValues': () => ({}),
    'plugin/servicewrapper.GetPluginMeta': (id: string) => ({ id, name: id, version: '0.0.0-bench', description: '' }),
    'plugin/servicewrapper.ListPlugins': () => [],
    'resource/servicewrapper.ListConnections': () => [{ id: BENCH_CONNECTION_ID, name: 'bench', labels: {} }],
    'resource/servicewrapper.ListAllConnections': () => ({}),
  });
}
