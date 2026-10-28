import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { LogSession, LogSessionOptions } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/logs/models';
import type { Value, ResourceReference, AccessRoute } from './resource/v2/domain';
import { encodeRequestJSON } from './resource/v2/requestJSON';

export {
  CloseSession, GetSession, GetSupportedResources, HasPlugin, ListPlugins,
  ListSessions, SendCommand, UpdateSessionOptions,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/logs/servicewrapper';

/** Canonical input to the encoded JSON bridge; resource bodies are never native JSON projections. */
export interface LogSessionRequest {
  resource_key: string;
  resource_id: string;
  resource_data?: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  options: LogSessionOptions;
}

export function CreateSession(plugin: string, connectionID: string, options: LogSessionRequest): CancellablePromise<LogSession | null> {
  return Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/logs.ServiceWrapper.CreateSession',
    plugin, connectionID, encodeRequestJSON(options, [plugin, connectionID]));
}
