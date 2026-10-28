import { Call, type CancellablePromise } from '@wailsio/runtime';
import { Session, type SessionOptions } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/exec/models';
import { encodeRequestJSON } from './resource/v2/requestJSON';

export {
  AttachSession, CloseSession, CreateTerminal, DetachSession, GetHandler,
  GetHandlers, GetPluginHandlers, GetSession, HasPlugin, ListPlugins,
  ListSessions, ResizeSession, WriteSession,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/exec/servicewrapper';

/** Wails receives exact JSON text; the public SDK-shaped API remains typed. */
export function CreateSession(plugin: string, connectionID: string, options: SessionOptions): CancellablePromise<Session | null> {
  return Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper.CreateSession',
    plugin, connectionID, encodeRequestJSON(options, [plugin, connectionID])).then((session: Session | null) => session === null ? null : Session.createFrom(session));
}
