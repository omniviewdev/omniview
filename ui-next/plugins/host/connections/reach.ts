import type { PanelStore, TabsStore } from '../../../shell';
import { connectionOf } from '../contributions';

/** What a disconnect would reach, as far as the window knows it: the tabs open on the connection, and the sessions of the bottom panel that are live and belong to it. */
export type Reach = { readonly tabs: number; readonly sessions: number };

/**
 * What a connection's disconnect reaches, counted from what the window already holds and no more (KL4): the tabs whose route names the connection, and the sessions of the bottom panel that are starting or running and whose
 * resource (their route) is in it. A session that ended is not reached, and nothing is asked of the plugin for it, so the count is exact only for what a route can say: a session that names no resource is not counted.
 */
export function reachOf(tabs: TabsStore, panel: PanelStore): (plugin: string, key: string) => Reach {
  return (plugin, key) => ({
    tabs: Object.values(tabs.getSnapshot().tabs).filter(({ location }) => location.route.plugin === plugin && connectionOf(location.route) === key).length,
    sessions: Object.values(panel.getSnapshot().sessions).filter(
      (session) => session.plugin === plugin && (session.state === 'starting' || session.state === 'running') && session.route !== undefined && connectionOf(session.route) === key,
    ).length,
  });
}
