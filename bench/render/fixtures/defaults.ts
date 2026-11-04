/** Backend answers every screen needs: settings, plugin metadata, connections, and idle activity subscriptions. */
import { handleAll } from '../harness/backend';

export const BENCH_CONNECTION_ID = 'bench';

export function installDefaultFixtures(): void {
  let activitySubscriptionID = 0;
  handleAll({
    'activity.FrontendService.Subscribe': () => ({
      id: `bench-activity-${++activitySubscriptionID}`,
      snapshot: { revision: 0, records: [] },
    }),
    'activity.FrontendService.Attach': () => ({ revision: 0, records: [] }),
    'activity.FrontendService.Snapshot': () => ({ revision: 0, records: [] }),
    'activity.FrontendService.Heartbeat': () => undefined,
    'activity.FrontendService.Unsubscribe': () => undefined,
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
}
