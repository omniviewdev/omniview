import { HOST, type PanelResult, type PanelState, type Session, type SessionId, type Tool, type ToolId, type ToolInput } from './types';
import { identifier, own, patch, refuse, settle, unchanged, type Step } from './state';

// The tool registry: the host's tools, and the tools each plugin brings. A plugin's tool id is made from the plugin's id and its own (`acme:metrics`), so two plugins, and a plugin and the
// host, never collide, and the owner of a tool is the one thing the model needs to know of who it is (PO1: a plugin that is off contributes nothing).

/** The id a plugin's tool has in the panel. The host's tools have plain ids, with no colon. */
export const toolIdOf = (plugin: string, local: string): ToolId => `${plugin}:${local}`;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Where a tool that says no place sits: after every tool that does, in the order they registered. */
const UNORDERED = Number.MAX_SAFE_INTEGER;

/** A tool as the registry holds it, or the reason it is not valid. `seq` is the place in the order of registration it keeps. */
function read(input: ToolInput, id: ToolId, owner: string, seq: number): Tool | undefined {
  const label = text(input.label);
  const icon = text(input.icon);
  if (id === '' || label === '' || icon === '') {
    return undefined;
  }

  const order = typeof input.order === 'number' && Number.isFinite(input.order) ? input.order : UNORDERED;
  return Object.freeze({ id, owner, label, icon, order, seq });
}

const same = (a: Tool, b: Tool): boolean => a.owner === b.owner && a.label === b.label && a.icon === b.icon && a.order === b.order;

/**
 * Registers a tool of the host. The same id registered again changes its words and keeps its place; the same words change nothing. An id with a colon is refused: that is how a plugin's
 * tool id is made, and the host must not be able to claim one.
 */
export function registerTool(state: PanelState, input: ToolInput): Step<PanelResult> {
  const id = identifier(input.id);
  const previous = own(state.tools, id);
  const tool = read(input, id, HOST, previous?.seq ?? state.registered + 1);
  if (tool === undefined || id.includes(':')) {
    return refuse(state, 'invalid', 'A tool needs an id without a colon, a label and a glyph.');
  }

  if (previous !== undefined && same(previous, tool)) {
    return unchanged(state);
  }

  const next = patch(state, { tools: Object.freeze({ ...state.tools, [id]: tool }), registered: previous === undefined ? state.registered + 1 : state.registered });
  return { state: settle(next), result: { status: 'done' } };
}

export function unregisterTool(state: PanelState, id: ToolId): Step<PanelResult> {
  const tool = own(state.tools, id);
  if (tool === undefined) {
    return refuse(state, 'missing', `There is no tool ${id}.`);
  }

  const { [id]: _removed, ...rest } = state.tools;
  return { state: settle(patch(state, { tools: Object.freeze(rest) })), result: { status: 'done' } };
}

/** The tools one plugin brings, by its own ids. */
export type PluginTools = { readonly id: string; readonly tools: readonly ToolInput[] };

/**
 * The plugins that are live now, and the tools each brings: the whole answer, in one transaction, so a plugin's tools and sessions go and return together (PO1, ch16 S114a). Every tool a
 * plugin brought before and brings no more is removed; a plugin that is no longer listed loses its tools, its sessions in them are hidden and the ones that were running end (the session is
 * a record of work that was running in the plugin, and the plugin is gone), and a plugin that returns has its sessions back, ended. The host's own tools are not touched.
 *
 * One thing is not hidden (A21, widened by the lead's ruling): the sessions a plugin has in a tool of the HOST are `held` when it leaves, whatever their state. They stay listed and mounted until their tab
 * closes, whether the plugin is off or has come back, and nothing changes them. A session that was starting or running is ended with the same cause; one that had ended or failed on its own is kept AS IT
 * WAS (its state, its cause and its time). A session in a tool that is not registered was never drawn and is hidden as before.
 */
export function syncPlugins(state: PanelState, plugins: readonly PluginTools[], now: number, cause: string): Step<PanelResult> {
  const live = [...new Set(plugins.map((plugin) => plugin.id).filter((id) => id !== '' && id !== HOST))].sort();
  // A map, not an object: an id the prototype also names (`__proto__`) must stay an entry of the tools it is.
  const kept = new Map<ToolId, Tool>();
  for (const [id, tool] of Object.entries(state.tools)) {
    if (tool.owner === HOST) {
      kept.set(id, tool);
    }
  }

  let registered = state.registered;
  for (const plugin of plugins) {
    if (!live.includes(plugin.id)) {
      continue;
    }

    for (const input of plugin.tools) {
      const local = identifier(input.id);
      const id = toolIdOf(plugin.id, local);
      const previous = own(state.tools, id);
      const tool = read(input, id, plugin.id, previous?.seq ?? registered + 1);
      if (tool === undefined || local === '') {
        continue;
      }

      if (previous === undefined) {
        registered += 1;
      }

      kept.set(id, previous !== undefined && same(previous, tool) ? previous : tool);
    }
  }

  const gone = new Set(state.live.filter((id) => !live.includes(id)));
  // The sessions of a plugin that left are rewritten in one copy of the dictionary: n of them are n entries written into the one new dictionary, not n copies of the old.
  const ended: Array<readonly [SessionId, Session]> = [];
  for (const id of state.order) {
    const session = own(state.sessions, id);
    if (session === undefined || !gone.has(session.plugin) || session.held === true) {
      continue;
    }

    const running = session.state === 'starting' || session.state === 'running';
    // A21: what a plugin has in a tool of the HOST is held, whatever its state: what was running ends with the cause, what was over stays as it was. What it has in a tool it brought is hidden with the
    // plugin (and ended when it ran), and so is a session of a tool that is not registered (nothing drew it): PO1.
    const held = own(state.tools, session.tool)?.owner === HOST;
    if (held) {
      ended.push([id, Object.freeze({ ...session, ...(running ? { state: 'ended' as const, since: now, cause } : {}), held: true as const })]);
    } else if (running) {
      ended.push([id, Object.freeze({ ...session, state: 'ended' as const, since: now, cause })]);
    }
  }

  const sameLive = live.length === state.live.length && live.every((id, index) => id === state.live[index]);
  const sameTools = kept.size === Object.keys(state.tools).length && [...kept].every(([id, tool]) => own(state.tools, id) === tool);
  if (sameLive && sameTools && ended.length === 0) {
    return unchanged(state);
  }

  const sessions = ended.length === 0 ? state.sessions : Object.freeze({ ...state.sessions, ...Object.fromEntries(ended) });
  const next = patch(state, { live: Object.freeze(live), tools: Object.freeze(Object.fromEntries(kept)), sessions, registered });
  return { state: settle(next), result: { status: 'done' } };
}
