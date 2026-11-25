import type { LogStreams, LogTarget } from '../../shell';
import type { LogSessionV1, LogTargetV1, PanelHostV1 } from '../contract/v1';
import { routeInputOf } from './panel';
import { MAX_FORWARDS_PER_CONNECTION, MAX_FORWARDS_PER_WINDOW, portsOf, type PortForwarding } from './portForward';
import { createForwardLedger } from './portLedger';

// The plugin's side of the panel handle (contract/v1.ts, `ContextV1.panel`): what a plugin asks of the window's bottom panel, bound to the plugin that asks. The Logs registry (ui-next/shell/panel/logs) is
// the host's; this only writes the plugin's words in the host's: a target with no plugin id (the handle knows whose it is, so a plugin cannot open a session in another's name) and a `RouteV1` for the
// resource, which becomes a route of the tab model in the plugin's own name. `LogStreams.open` is the one entry point; who supplies a target is not decided here (decision A20). The ports member (PF1) is bound to the
// plugin as well, and to the connection the page is read in (the route's, else the plugin's only one: `panelConnectionOf` in `contributions.ts`, which the window asks before it asks for a handle): the host fills both in when a page forwards a port (`portForward.ts`), so a page forwards
// in its own connection and in no other. A handle made for no connection has no ports member at all: a member that is there and can only refuse is worse than one that is absent. Every handle is shared by the pages of its plugin (and connection), so each is frozen with the members it holds: a page cannot
// replace what the others call.

/** The host's descriptor for a plugin's target. A member the plugin did not write well is passed on as it is, for the registry to refuse by name. */
function descriptorOf(plugin: string, given: unknown): LogTarget {
  const target: Partial<LogTargetV1> = typeof given === 'object' && given !== null ? given : {};
  const { resource } = target;
  return {
    plugin,
    id: target.id ?? '',
    title: target.title ?? '',
    scope: target.scope,
    resource: typeof resource === 'object' && resource !== null ? { label: resource.label, kind: resource.kind, icon: resource.icon, route: resource.route === undefined ? undefined : routeInputOf(plugin, resource.route) } : undefined,
    open: target.open ?? (() => {
      throw new Error('the target has no way to open a stream');
    }),
  };
}

/** What `ctx.panel.logs` is for one plugin. */
function logsOf(plugin: string, streams: LogStreams): PanelHostV1['logs'] {
  return Object.freeze({
    open: (target: LogTargetV1): LogSessionV1 | undefined => {
      const opened = streams.open(descriptorOf(plugin, target));
      return opened === undefined ? undefined : { id: opened.id, close: opened.close };
    },
  });
}

/** What the host holds for a plugin: its Logs member, and its handle for each connection a page of it is read in (`''` for none). */
type PluginHandles = { readonly logs: PanelHostV1['logs']; readonly byConnection: Map<string, PanelHostV1> };

/**
 * The handle of each plugin in each connection, made once and given again as it was, so a context that holds it, and a hook that lists it among its dependencies, stay what they were from one render to the next. A plugin's Logs
 * member is one object whatever the connection, so a hook that depends on it alone is not told of a page that moves to another connection. A page that is read in no connection, and a palette command, ask for none (or an empty
 * one) and share a handle with no ports member. With no `forwarding` the window has no port-forward service and no handle has one, as on a host that predates it. Every handle and every member is frozen. The count of the forwards the
 * window has started (`portLedger.ts`) is made once here and shared by every handle, whatever its plugin and connection: the caps on a plugin's forwards in a connection and on the window's are what that one count says.
 */
export function panelHostsOf(streams: LogStreams, forwarding?: PortForwarding): (plugin: string, connection?: string) => PanelHostV1 {
  const plugins = new Map<string, PluginHandles>();
  const counted = forwarding === undefined ? undefined : { forwarding, ledger: createForwardLedger(forwarding, { connection: MAX_FORWARDS_PER_CONNECTION, window: MAX_FORWARDS_PER_WINDOW }) };
  return (plugin, connection) => {
    let handles = plugins.get(plugin);
    if (handles === undefined) {
      handles = { logs: logsOf(plugin, streams), byConnection: new Map() };
      plugins.set(plugin, handles);
    }

    const scope = connection ?? '';
    let host = handles.byConnection.get(scope);
    if (host === undefined) {
      host = Object.freeze(counted === undefined || scope === '' ? { logs: handles.logs } : { logs: handles.logs, ports: portsOf(counted.forwarding, counted.ledger, plugin, scope) });
      handles.byConnection.set(scope, host);
    }

    return host;
  };
}
