import { SettingsService, WindowClient } from '@omniviewdev/runtime/api';
import { Events, onEventsReconnect } from '@omniviewdev/runtime/runtime';
import { pageClock } from './clock';
import { createSettingsSession, type SettingsSession } from './model/session';
import type { SettingsClient, SettingsRequest, SettingsWindowClient } from './model/types';

// The host's settings service as Settings reads it: the runtime's own bindings (`backend/pkg/settings/binding.go`: `GetSnapshot`, `Validate`, `Commit`) and the event the host emits after every commit
// (`settings/changed`, `internal/bootstrap/bootstrap.go`). Settings asks for the HOST scope only: a plugin's settings are a later slice. This file is part of the lazy chunks of the sheet and of the window.

const HOST = { kind: 'host' } as const;

export function runtimeClient(): SettingsClient {
  return {
    snapshot: async () => SettingsService.GetSnapshot(HOST),
    validate: async (id, value) => SettingsService.Validate(HOST, id, value),
    commit: async (values) => SettingsService.Commit(HOST, { ...values }),
    onReconnect: (listener) => onEventsReconnect(listener),
    onChanged: (listener) =>
      Events.On('settings/changed', (event) => {
        // The event is the scope that changed; a plugin's settings are not Settings'.
        const scope: unknown = event.data;
        if (typeof scope === 'object' && scope !== null && 'kind' in scope && scope.kind === 'host') {
          listener();
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
