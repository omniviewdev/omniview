import React from 'react';

import { networker } from '../../internal/models';
import { BrowserOpenURL } from '../../internal/runtime/runtime';
import { 
  ClosePortForwardSession, 
  FindPortForwardSessions, 
  StartResourcePortForwardingSession,
} from '../../internal/networker/Client';

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
  * The resource data object
  */
  resource: any;
  /**
  * The port to forward on the resource
  * @example 8080
  */
  fromPort: number;
  /**
  * The port on the host to forward to. If none is provided, a random port will be assigned.
  * Note: If specifying, it is highly advised to use a port in the range 30000-32767
  * @example 31234
  */
  toPort?: number;
  /**
  * The protocol to forward. Default is TCP.
  */
  protocol?: 'TCP' | 'UDP';
  /**
  * Parameters to pass to the resource to configure the port forward.
  */
  parameters?: Record<string, string>
  /**
  * Whether to open the forwarded port in the default browser. Default is false.
  */
  openInBrowser?: boolean;
  /**
  * Optional labels to apply to the port forward session.
  */
  labels?: Record<string, string>;
};

export interface PortForwardResourceFunction {
  (opts: PortForwardResourceOpts): Promise<networker.PortForwardSession>;
}

export interface ResourcePortForwarder {
  sessions: Array<networker.PortForwardSession>;
  forward: PortForwardResourceFunction;
  close: (sessionId: string) => Promise<void>;
}

/**
* Programatically forward a port from a resource object to the host.
*/
export function useResourcePortForwarder({ pluginID, connectionID, resourceID }: { pluginID: string, connectionID: string, resourceID: string }): ResourcePortForwarder {
  const [sessions, setSessions] = React.useState<Array<networker.PortForwardSession>>([]);

  React.useEffect(() => {
    if (!pluginID || !connectionID || !resourceID) {
      return;
    }
     
    FindPortForwardSessions(pluginID, connectionID, networker.FindPortForwardSessionRequest.createFrom({
      resource_id: resourceID,
      connection_id: connectionID,
    })).then((sessions) => {
      setSessions(sessions);
    }).catch((e) => {
      if (e instanceof Error) {
        console.log(e);
      }
    });
  }, [pluginID, connectionID]);

  const forward: PortForwardResourceFunction = React.useCallback(async (opts) => {
    const sessionOpts =networker.PortForwardSessionOptions.createFrom({
      source_port: opts.fromPort,
      destination_port: opts.toPort || 0,
      protocol: opts.protocol || 'TCP',
      connection_type: "RESOURCE",
      connection: {
        resource_data: opts.resource,
        connection_id: connectionID,
        plugin_id: pluginID,
        resource_id: opts.resourceId,
        resource_key: opts.resourceKey,
      },
      labels: opts.labels || {},
      params: opts.parameters || {},
    });

    try {
      const session = await StartResourcePortForwardingSession(pluginID, connectionID, sessionOpts)
      setSessions([...sessions, session]);
      if (opts.openInBrowser) {
        BrowserOpenURL(`http://localhost:${session.destination_port}`);
      }

      return session;
    } catch (e) {
      if (e instanceof Error) {
        // TODO: Implement our error handling once we have our snackbar implementation worked 
        // into the provider.
        console.log(e);
      }
      throw e;
    }
  }, [pluginID, connectionID, sessions]);

  const close = React.useCallback(async (sessionId: string) => {
    try {
      await ClosePortForwardSession(sessionId);
      setSessions(sessions.filter((s) => s.id !== sessionId));
    } catch (e) {
      if (e instanceof Error) {
        // TODO: Implement our error handling once we have our snackbar implementation worked 
        // into the provider.
        console.log(e);
      }
      throw e;
    }
  }, [sessions]);

  return {
    sessions,
    forward,
    close,
  }
}
