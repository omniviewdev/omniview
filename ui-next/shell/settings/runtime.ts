import { SettingsService } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import type { SettingsClient } from './model/types';

// The host's settings service as the Settings sheet reads it: the runtime's own bindings (`backend/pkg/settings/binding.go`: `GetSnapshot`, `Validate`, `Commit`) and the event the host emits after every commit
// (`settings/changed`, `internal/bootstrap/bootstrap.go`). The sheet asks for the HOST scope only: a plugin's settings are a later slice. This file is part of the sheet's lazy chunk.

const HOST = { kind: 'host' } as const;

export function runtimeClient(): SettingsClient {
  return {
    snapshot: async () => SettingsService.GetSnapshot(HOST),
    validate: async (id, value) => SettingsService.Validate(HOST, id, value),
    commit: async (values) => SettingsService.Commit(HOST, { ...values }),
    onChanged: (listener) =>
      Events.On('settings/changed', (event) => {
        // The event is the scope that changed; a plugin's settings are not this sheet's.
        const scope: unknown = event.data;
        if (typeof scope === 'object' && scope !== null && 'kind' in scope && scope.kind === 'host') {
          listener();
        }
      }),
  };
}
