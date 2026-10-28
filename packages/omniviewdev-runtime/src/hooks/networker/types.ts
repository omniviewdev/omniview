import type { PortForwardSession } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/networker/models';
import type { Value, ResourceReference, AccessRoute } from '../../resource/v2/domain';

export type PortForwardResourceOpts = {
  /**
  * The resource key identifier.
  * For example, the Kubernetes plugin supports the following resource keys:
  * - 'core::v1::Pod'
  */
  resourceKey: string;
  /**
  * The resource ID
  */
  resourceId: string;
  /**
  * The canonical resource body, never the presentation projection.
  */
  resource: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  /**
  * The port to forward on the resource
  * @example 8080
  */
  remotePort: number;
  /**
  * The port on the host to forward to. If none is provided, a random port will be assigned.
  * Note: If specifying, it is highly advised to use a port in the range 30000-32767
  * @example 31234
  */
  localPort?: number;
  /**
  * The protocol to forward. Default is TCP.
  */
  protocol?: 'TCP' | 'UDP';
  /**
  * Parameters to pass to the resource to configure the port forward.
  */
  parameters?: Record<string, string>;
  /**
  * Whether to open the forwarded port in the default browser. Default is false.
  */
  openInBrowser?: boolean;
  /**
  * Optional labels to apply to the port forward session.
  */
  labels?: Record<string, string>;
};

export type PortForwardResourceFunction = (opts: PortForwardResourceOpts) => Promise<PortForwardSession>;

export type ResourcePortForwarder = {
  sessions: PortForwardSession[];
  forward: PortForwardResourceFunction;
  close: (sessionId: string) => Promise<void>;
};


