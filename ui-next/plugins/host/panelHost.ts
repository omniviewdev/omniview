import type { LogStreams, LogTarget } from '../../shell';
import type { LogSessionV1, LogTargetV1, PanelHostV1 } from '../contract/v1';
import { routeInputOf } from './panel';

// The plugin's side of the panel handle (contract/v1.ts, `ContextV1.panel`): what a plugin asks of the window's bottom panel, bound to the plugin that asks. The Logs registry (ui-next/shell/panel/logs) is
// the host's; this only writes the plugin's words in the host's: a target with no plugin id (the handle knows whose it is, so a plugin cannot open a session in another's name) and a `RouteV1` for the
// resource, which becomes a route of the tab model in the plugin's own name. `LogStreams.open` is the one entry point; who supplies a target is not decided here (decision A20).

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

/** What `ctx.panel` is for one plugin. */
function panelHostOf(plugin: string, streams: LogStreams): PanelHostV1 {
  return {
    logs: {
      open: (target): LogSessionV1 | undefined => {
        const opened = streams.open(descriptorOf(plugin, target));
        return opened === undefined ? undefined : { id: opened.id, close: opened.close };
      },
    },
  };
}

/**
 * The handle of each plugin, made once for the plugin and given again as it was, so a context that holds it, and a hook that lists it among its dependencies, stay what they were from one render to
 * the next.
 */
export function panelHostsOf(streams: LogStreams): (plugin: string) => PanelHostV1 {
  const hosts = new Map<string, PanelHostV1>();
  return (plugin) => {
    let host = hosts.get(plugin);
    if (host === undefined) {
      host = panelHostOf(plugin, streams);
      hosts.set(plugin, host);
    }

    return host;
  };
}
