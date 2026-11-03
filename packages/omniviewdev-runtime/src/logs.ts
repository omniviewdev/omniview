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
  const { release, settled } = PrepareSessionEvents(sessionId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { clearTimeout(timer); release(); };
  try {
    const call = Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/logs.ServiceWrapper.CreateSession',
      plugin, connectionID, request);
    const deadline = new Error('Log session creation timed out after 120 seconds.');
    timer = setTimeout(() => { void call.cancel(deadline); }, 120000);
    return call.then((session: LogSession | null) => {
        clearTimeout(timer);
        if (!session || session.id !== sessionId) {
          release();
          throw new Error('Log provider returned an invalid session.');
        }
        settled();
        return session;
      }, error => {
        cleanup();
        if (error?.cause === deadline) throw deadline;
        throw error;
      }, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}
