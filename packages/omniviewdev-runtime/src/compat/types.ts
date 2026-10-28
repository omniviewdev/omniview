/**
 * Back-compat view of the plugin-sdk `types` package for plugins built against
 * the Wails v2 bindings. See ./legacyEnum.
 */
import { ConnectionStatusCode as Generated } from '../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import { withLegacyNames } from './legacyEnum';

export {
  Capability as PluginCapability,
  Connection,
  ConnectionAutoConnect,
  ConnectionAutoConnectRetry,
  ConnectionAutoConnectTrigger,
  ConnectionLifecycle,
  ConnectionStatus,
  PluginInfo,
} from '../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';

export const ConnectionStatusCode = withLegacyNames(Generated, 'ConnectionStatus');
export type ConnectionStatusCode = Generated;
