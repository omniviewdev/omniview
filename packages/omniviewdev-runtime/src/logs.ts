import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { LogSession, LogSessionOptions } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/logs/models';
import type { Value, ResourceReference, AccessRoute } from './resource/v2/domain';
import { encodeRequestJSON } from './resource/v2/requestJSON';
import { PrepareSessionEvents } from './logSessionEvents';
export { SubscribeSessionEvents } from './logSessionEvents';

export {
  CloseSession, GetSession, GetSupportedResources, HasPlugin, ListPlugins,
  ListSessions, SendCommand, UpdateSessionOptions,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/logs/servicewrapper';

/** Canonical input to the encoded JSON bridge; resource bodies are never native JSON projections. */
export interface LogSessionRequest {
  /** Optional correlation ID for subscribing before session creation. Not an authority token. */
  session_id?: string;
  resource_key: string;
  resource_id: string;
  resource_data?: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  options: LogSessionOptions;
}

export function CreateSession(plugin: string, connectionID: string, options: LogSessionRequest): CancellablePromise<LogSession | null> {
  const sessionId = options.session_id ?? crypto.randomUUID();
  const request = encodeRequestJSON({ ...options, session_id: sessionId }, [plugin, connectionID]);
  const release = PrepareSessionEvents(sessionId);
  return Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/logs.ServiceWrapper.CreateSession',
    plugin, connectionID, request)
    .then((session: LogSession | null) => {
      if (!session || session.id !== sessionId) {
        release();
        throw new Error('Log provider returned an invalid session.');
      }
      return session;
    }, error => {
      release();
      throw error;
    });
}
