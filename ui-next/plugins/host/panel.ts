import { normaliseRoute, type PanelCard, type PanelNewSession, type PanelSession, type PanelSessionInput, type PluginTools, type Route, type RouteInput } from '../../shell';
import type { PanelCardV1, PanelSessionV1, PanelToolV1, RouteV1 } from '../contract/v1';
import { connectionOf, textParamsOf } from './contributions';
import type { PluginEntry } from './pluginStore';
import { addressOf } from './route';

// The host's side of what a plugin brings to the bottom panel (contract/v1.ts, `panel`; the model is ui-next/shell/core/panel). Pure: the plugins' tools for the panel's registry, which
// plugin's body and card answer for a session, how a session starts from a tool, and how the plugin's route (a page, a connection, text parameters) and the model's (a plugin, a page,
// plain data) are written one in the other. The host runs no plugin code here but the two it is asked to: a card and the start of a session, each a plain function of the plugin's.

type Ready = Extract<PluginEntry, { readonly phase: 'ready' }>;

/** A tool a plugin brought, with the plugin and the id the plugin gave it. */
export type FoundTool = { readonly plugin: string; readonly local: string; readonly tool: PanelToolV1; readonly entry: Ready };

const isReady = (entry: PluginEntry): entry is Ready => entry.phase === 'ready';

/** What a plugin's dictionary holds under an id: an entry of its own, never a member the prototype brings (`acme:constructor` is a tool id nobody brought, not `Object`). */
const ownOf = <T>(dictionary: Readonly<Record<string, T>> | undefined, key: string): T | undefined => (dictionary !== undefined && Object.hasOwn(dictionary, key) ? dictionary[key] : undefined);

/**
 * The plugins that are live and the tools each brings, for the panel's registry (`PanelStore.syncPlugins`): a plugin is live while its interface is ready, whether it brings a tool or not (the
 * sessions it opens in a tool of the host show while it is). One that is loading or did not load contributes nothing.
 */
export function panelPluginsOf(entries: readonly PluginEntry[]): readonly PluginTools[] {
  return entries.filter(isReady).map((entry) => ({
    id: entry.id,
    tools: Object.entries(entry.contribution.panel?.tools ?? {}).map(([id, tool]) => ({ id, label: tool.label, icon: tool.icon, order: tool.order })),
  }));
}

/** The tool a panel tool id names: the id the panel makes is the plugin's, a colon, the plugin's own id. A tool of the host, a plugin that is not ready or a tool it does not have is `undefined`. */
export function toolOf(entries: readonly PluginEntry[], toolId: string): FoundTool | undefined {
  for (const entry of entries) {
    const prefix = `${entry.id}:`;
    if (isReady(entry) && toolId.startsWith(prefix)) {
      const local = toolId.slice(prefix.length);
      const tools = entry.contribution.panel?.tools;
      const tool = ownOf(tools, local);
      if (tool !== undefined) {
        return { plugin: entry.id, local, tool, entry };
      }
    }
  }

  return undefined;
}

/** A plugin's route as the model writes it: the page is the contribution, and the connection is a parameter like the others. */
export function routeInputOf(plugin: string, route: RouteV1): RouteInput {
  return { plugin, contribution: route.page, params: route.connection === undefined ? { ...route.params } : { ...route.params, connection: route.connection } };
}

/** The model's route as the plugin reads it: the connection leaves the parameters, and a parameter that is not text is dropped (the plugin's pages take text). */
export function routeV1Of(route: Route): RouteV1 {
  const { connection } = route.params;
  return { page: route.contribution, connection: typeof connection === 'string' ? connection : undefined, params: textParamsOf(route) };
}

/** The address of a model route, the one `parseRoute` reads: the plugin, the page, the connection first and then the text parameters. A card's resource link carries it as its `href`, so an address that is copied, or followed by something that did not intercept the click, opens where the route was. */
export const routeAddressOf = (route: Route): string =>
  addressOf({ plugin: route.plugin, page: route.contribution, params: { connection: connectionOf(route), ...textParamsOf(route) } });

/** A panel session as a plugin's body and card read it. */
export function sessionV1(session: PanelSession): PanelSessionV1 {
  return {
    id: session.id,
    tool: session.tool,
    title: session.title,
    scope: session.scope,
    state: session.state,
    since: session.since,
    cause: session.cause,
    ...(session.route === undefined ? {} : { route: routeV1Of(session.route) }),
  };
}

/** A plugin's card, as the shell draws it: the route the resource names is a model route, in the plugin that opened the session. */
function cardOfV1(plugin: string, card: PanelCardV1): PanelCard {
  const resource = card.resource;
  const route = resource?.route === undefined ? undefined : normaliseRoute(routeInputOf(plugin, resource.route));
  return {
    kind: card.kind,
    icon: card.icon,
    resource: resource === undefined ? undefined : { label: resource.label, kind: resource.kind, icon: resource.icon, route },
    facts: card.facts,
    state: card.state,
    actions: card.actions?.map((action) => ({ label: action.label, icon: action.icon, onSelect: action.onSelect, disabledReason: action.disabledReason })),
  };
}

/**
 * What the card of a session says, asked of the plugin that opened it: the `card` of its tool when the session is in a tool of that plugin's own, else the `card` the plugin gave for the
 * tool of the host the session is in. `undefined` when the plugin says nothing; the host's own card is drawn then. A card that throws throws here: the card's component answers for it.
 */
export function cardOfSession(entries: readonly PluginEntry[], session: PanelSession): PanelCard | undefined {
  const own = toolOf(entries, session.tool);
  const owner = entries.find((entry) => entry.id === session.plugin);
  const ask = own?.plugin === session.plugin ? own.tool.card : owner !== undefined && isReady(owner) ? ownOf(owner.contribution.panel?.sessions, session.tool)?.card : undefined;
  const card = ask?.(sessionV1(session));
  return card === undefined ? undefined : cardOfV1(session.plugin, card);
}

/**
 * How a session starts from a tool: the `+` of the strip and the button of an empty tool. The plugin says what opens (`open`); `start` opens it in the tool, owned by the plugin, through
 * `open` (the panel's `openSession`). `undefined` for a tool of the host, a plugin that is not ready, or a tool that has no way to start one.
 */
export function newSessionOf(entries: readonly PluginEntry[], toolId: string, open: (input: PanelSessionInput) => void): PanelNewSession | undefined {
  const found = toolOf(entries, toolId);
  const fresh = found?.tool.newSession;
  if (found === undefined || fresh === undefined) {
    return undefined;
  }

  return {
    label: fresh.label,
    start: () => {
      try {
        const made = fresh.open();
        if (made !== undefined) {
          open({
            tool: toolId,
            plugin: found.plugin,
            title: made.title,
            scope: made.scope,
            route: made.route === undefined ? undefined : routeInputOf(found.plugin, made.route),
            state: made.state,
            cause: made.cause,
          });
        }
      } catch (error) {
        // `open` is the plugin's code, run from a click, and an error boundary does not catch an error in an event handler: it would end at the window's error report, with no session and no word.
        // It goes to the log under the panel's name, as a card that cannot describe itself does (the app has no notification surface yet), and the panel stays as it was.
        console.error(`[panel] ${found.plugin} could not start a session in ${found.local}`, error);
      }
    },
  };
}
