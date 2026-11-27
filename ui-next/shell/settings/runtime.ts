import { PluginManager, SettingsService, WindowClient } from '@omniviewdev/runtime/api';
import { PluginCapability } from '@omniviewdev/runtime/models';
import { Events, onEventsReconnect } from '@omniviewdev/runtime/runtime';
import { readRunning, STATE_CHANGE_EVENT } from '../../plugins/host/lifecycle';
import { pageClock } from './clock';
import { createSettingsSession, type SettingsSession } from './model/session';
import { HOST_SCOPE, type SettingsClient, type SettingsRequest, type SettingsWindowClient } from './model/types';

// PluginInfo.capabilities comes from the backend handshake; metadata.capabilities is only the manifest.
const INVENTORY_EVENTS = ['plugin/init_complete', 'plugin/inventory_changed', 'plugin/enablement_changed', 'plugin/install_finished', 'plugin/update_complete', 'plugin/dev_install_complete', 'plugin/dev_reload_complete', 'plugin/recovered', 'plugin/unloaded'] as const;

export function runtimeClient(): SettingsClient {
  return {
    snapshot: async (scope) => SettingsService.GetSnapshot(scope),
    validate: async (scope, id, value) => SettingsService.Validate(scope, id, value),
    commit: async (scope, values) => SettingsService.Commit(scope, values),
    inventory: async () => ((await PluginManager.ListPlugins()) ?? [])
      .filter(({ capabilities }) => capabilities?.includes(PluginCapability.CapabilitySettings))
      .map(({ id, metadata }) => ({ id, name: metadata.name, description: metadata.description, icon: metadata.icon })),
    onInventoryChanged: (listener) => {
      const stops = INVENTORY_EVENTS.map((name) => Events.On(name, listener));
      // A normal reload completes with this transition, not a dev-install or inventory event.
      stops.push(Events.On(STATE_CHANGE_EVENT, ({ data }) => {
        if (readRunning(data) !== undefined) {
          listener();
        }
      }));
      return () => {
        for (const stop of stops) {
          stop();
        }
      };
    },
    onReconnect: (listener) => onEventsReconnect(listener),
    onChanged: (listener) =>
      Events.On('settings/changed', (event) => {
        const scope: unknown = event.data;
        if (typeof scope !== 'object' || scope === null || !('kind' in scope)) {
          return;
        }

        if (scope.kind === 'host' && (!('pluginId' in scope) || scope.pluginId === '')) {
          listener(HOST_SCOPE);
        } else if (scope.kind === 'plugin' && 'pluginId' in scope && typeof scope.pluginId === 'string' && scope.pluginId !== '') {
          listener({ kind: 'plugin', pluginId: scope.pluginId });
        }
      }),
  };
}

/** The session of one opening or of the Settings window's life: over the client the host passed (a fixture's, in a probe) or the runtime's. */
export function createSession(client: SettingsClient | undefined): SettingsSession {
  return createSettingsSession({ client: client ?? runtimeClient(), scheduler: pageClock });
}

function isRequest(value: unknown): value is SettingsRequest {
  return typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'number' && 'target' in value && typeof value.target === 'string' && 'visible' in value && typeof value.visible === 'boolean';
}

/** The window service as the Settings window reads it: `GetSettingsState`, the `settings/state` event and `HideSettings` (`backend/window/settings.go`). */
export function runtimeWindowClient(): SettingsWindowClient {
  return {
    state: async () => WindowClient.GetSettingsState(),
    onState: (listener) =>
      Events.On('settings/state', (event) => {
        const state: unknown = event.data;
        if (isRequest(state)) {
          listener(state);
        }
      }),
    hide: async () => WindowClient.HideSettings(),
  };
}
