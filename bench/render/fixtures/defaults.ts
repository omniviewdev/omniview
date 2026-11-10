/** Backend answers every screen needs: settings, plugin metadata, connections, the activity service and host services. */
import { handleAll } from '../harness/backend';
import { installActivityFixture, type ActivityFixture } from './activity';
import { installHostFixtures, type HostFixture } from './host';

export const BENCH_CONNECTION_ID = 'bench';

export interface DefaultFixtures {
  activity: ActivityFixture;
  host: HostFixture;
}

/**
 * Register the common backend handlers with fresh activity and host state, plus default settings
 * and connection responses. Return the activity and host inspection helpers.
 */
export function installDefaultFixtures(): DefaultFixtures {
  // Whole protocols, not stubs: see fixtures/activity.ts and fixtures/host.ts.
  const activity = installActivityFixture();
  const host = installHostFixtures();
  handleAll({
    'internal/settings/servicewrapper.Values': () => ({}),
    'internal/settings/servicewrapper.ListSettings': () => ({}),
    'internal/settings/servicewrapper.GetCategories': () => [],
    'plugin/settings/servicewrapper.PluginValues': () => ({}),
    'plugin/servicewrapper.GetPluginMeta': (id: string) => ({ id, name: id, version: '0.0.0-bench', description: '' }),
    'plugin/servicewrapper.ListPlugins': () => [],
    'resource/servicewrapper.CheckConnection': (_pluginID: string, connectionID: string) => ({
      connection: { id: connectionID, name: connectionID, labels: {} },
      status: 'CONNECTED',
    }),
    'resource/servicewrapper.ListConnections': () => [{ id: BENCH_CONNECTION_ID, name: 'bench', labels: {} }],
    'resource/servicewrapper.ListAllConnections': () => ({}),
  });
  return { activity, host };
}
