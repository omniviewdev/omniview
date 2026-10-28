import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { PortForwardProtocol, PortForwardSession, PortForwardSessionEncryption } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/networker/models';
import type { Value, ResourceReference, AccessRoute } from './resource/v2/domain';
import { encodeRequestJSON } from './resource/v2/requestJSON';

export {
  ClosePortForwardSession, FindPortForwardSessions, GetPortForwardSession,
  GetSupportedPortForwardTargets, HasPlugin, ListAllPortForwardSessions,
  ListPlugins, ListPortForwardSessions,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/networker/servicewrapper';

export interface ResourcePortForwardTarget {
  resource_data?: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  connection_id: string;
  plugin_id: string;
  resource_id: string;
  resource_key: string;
}

/** The SDK's resource and static connection variants, paired with their wire discriminator. */
export type PortForwardSessionRequest = {
  local_port: number;
  remote_port: number;
  protocol: `${PortForwardProtocol}`;
  labels?: Record<string, string>;
  params?: Record<string, string>;
  encryption?: PortForwardSessionEncryption;
} & (
  | { connection_type: 'RESOURCE'; connection: ResourcePortForwardTarget }
  | { connection_type: 'STATIC'; connection: { address: string } }
);

export function StartResourcePortForwardingSession(plugin: string, connectionID: string, options: PortForwardSessionRequest): CancellablePromise<PortForwardSession | null> {
  return Call.ByName('github.com/omniviewdev/omniview/backend/pkg/plugin/networker.ServiceWrapper.StartResourcePortForwardingSession',
    plugin, connectionID, encodeRequestJSON(options, [plugin, connectionID]));
}
