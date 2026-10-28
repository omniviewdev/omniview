import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { PortForwardSessionOptions, PortForwardSession } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/networker/models';
import { encodeRequestJSON } from './resource/v2/requestJSON';

export {
  ClosePortForwardSession, FindPortForwardSessions, GetPortForwardSession,
  GetSupportedPortForwardTargets, HasPlugin, ListAllPortForwardSessions,
  ListPlugins, ListPortForwardSessions,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/networker/servicewrapper';

export function StartResourcePortForwardingSession(plugin: string, connectionID: string, options: PortForwardSessionOptions): CancellablePromise<PortForwardSession | null> {
  return Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/networker.ServiceWrapper.StartResourcePortForwardingSession',
    plugin, connectionID, encodeRequestJSON(options, [plugin, connectionID]));
}
