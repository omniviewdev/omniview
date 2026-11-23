import { Call, type CancellablePromise } from '@wailsio/runtime';
import { Session, type SessionOptions } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/exec/models';
import { encodeRequestJSON } from './resource/v2/requestJSON';

export {
  AckTerminal, AttachSession, AttachTerminal, CloseSession, CreateTerminal, DetachSession, DetachTerminal, GetHandler,
  GetHandlers, GetNativeTerminalSupport, GetPluginHandlers, GetSession, HasPlugin, IsBusy, ListPlugins,
  ListSessions, ListTerminals, OfferSession, ResizeSession, ResizeTerminal, WriteSession, WriteTerminal,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/exec/servicewrapper';

/** Wails receives exact JSON text; the public SDK-shaped API remains typed. */
export function CreateSession(plugin: string, connectionID: string, options: SessionOptions): CancellablePromise<Session | null> {
  return Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper.CreateSession',
    plugin, connectionID, encodeRequestJSON(options, [plugin, connectionID])).then((session: Session | null) => session === null ? null : Session.createFrom(session));
}

/** Plan and launch a new external process without creating an integrated session. */
export function OpenNativeSession(plugin: string, connectionID: string, options: SessionOptions): CancellablePromise<void> {
  return Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper.OpenNativeSession',
    plugin, connectionID, encodeRequestJSON(options, [plugin, connectionID]));
}
