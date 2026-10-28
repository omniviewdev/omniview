import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { CreateSessionOptions, LogSession } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/logs/models';
import { encodeRequestJSON } from './resource/v2/requestJSON';

export {
  CloseSession, GetSession, GetSupportedResources, HasPlugin, ListPlugins,
  ListSessions, SendCommand, UpdateSessionOptions,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/logs/servicewrapper';

export function CreateSession(plugin: string, connectionID: string, options: CreateSessionOptions): CancellablePromise<LogSession | null> {
  return Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/logs.ServiceWrapper.CreateSession',
    plugin, connectionID, encodeRequestJSON(options, [plugin, connectionID]));
}
