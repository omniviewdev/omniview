import { equalRatios, fitRatios, minRatio, moveBoundary, PANE_MIN_PX } from './ratios';
import { openSession } from './sessions';
import { effectiveSession, identifier, own, patch, refuse, sessionVisible, settle, toolVisible, unchanged, type Context, type Step } from './state';
import type { PaneAxis, PaneGroup, PaneId, PaneLayout, PanelResult, PanelState, SessionId, SessionInput, SplitResult, ToolId } from './types';

// The panes of a tool: a new session beside the active one, the sash, the shares. A tool that has no group shows one session and none of this applies to it. Closing a pane is closing its session
// (`closeSession`, ./sessions.ts); what keeps the active session in the active pane is `settle` (./state.ts).

const DONE: PanelResult = Object.freeze({ status: 'done' });

export type SplitOptions = {
  /** The panel's length along the group's axis in pixels: the layout knows it, the model does not. A pane needs `PANE_MIN_PX` of it. */
  readonly extent: number;
  /** How a tool's first split lays its panes out; a group has ONE axis (flat, as a terminal group is: no nesting), so another axis for a tool that has panes is refused (`axis`). Default: `row`. */
  readonly axis?: PaneAxis | undefined;
  /** The new pane goes after the pane of this session when it is in the group, whichever pane is active (a split pressed in a pane goes beside THAT pane, though the keyboard has gone elsewhere while the host answered); a session that is in no pane, or none, leaves the active pane the anchor. */
  readonly beside?: SessionId | undefined;
};

/** Whether one more pane fits in a tool: every pane, the new one included, would have its minimum of `extent` (the length the panes share along the axis). A tool with no group has one pane. */
export function roomForPane(state: PanelState, tool: ToolId, extent: number): boolean {
  return ((own(state.panes, tool)?.panes.length ?? 1) + 1) * PANE_MIN_PX <= extent;
}

const usable = (extent: number): boolean => Number.isFinite(extent) && extent > 0;

const sameShares = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((one, index) => one === b[index]);

const slot = (number: number): PaneId => `p${String(number)}`;

/** The group of a tool, when it has one. */
const groupOf = (state: PanelState, tool: ToolId): PaneGroup | undefined => own(state.panes, tool);

/**
 * Opens a NEW session in a new pane beside the active one. The session is made here, with the id the model gives it (or one the caller gives that nobody has: a session that exists is `taken`, so a split is never
 * a copy of one), and every pane of the tool has the same share afterwards. The new pane is the active one, the panel opens on it and its body is mounted. A tool with no session has nothing to split: the
 * session opens as it would from `openSession`, in no group. Refused: a tool that is not there or not visible, a plugin that is not live, an `extent` that is not a length, and a tool that has no room for another pane.
 */
export function splitPane(state: PanelState, tool: ToolId, input: Omit<SessionInput, 'tool'>, ctx: Context, options: SplitOptions): Step<SplitResult> {
  const id = identifier(tool);
  if (!usable(options.extent)) {
    return refuse(state, 'invalid', 'A split needs the length of the panel in pixels.');
  }

  const registered = own(state.tools, id);
  if (registered === undefined || !toolVisible(state, registered)) {
    return refuse(state, 'missing', `There is no tool ${id}.`);
  }

  const group = groupOf(state, id);
  const beside = effectiveSession(state, id);
  if (beside === null && group === undefined) {
    const opened = openSession(state, { ...input, tool: id }, ctx);
    return opened.result.status === 'done' ? { state: opened.state, result: { status: 'done', id: opened.result.id, pane: slot(1) } } : { state, result: opened.result };
  }

  if (group !== undefined && options.axis !== undefined && options.axis !== group.axis) {
    return refuse(state, 'axis', `The panes of ${id} are laid out as a ${group.axis}: a group has one axis.`);
  }

  if (!roomForPane(state, id, options.extent)) {
    return refuse(state, 'full', `There is no room for another pane: each needs ${String(PANE_MIN_PX)} px.`);
  }

  const opened = openSession(state, { ...input, tool: id }, ctx, { reveal: false });
  if (opened.result.status !== 'done') {
    return { state, result: opened.result };
  }

  const made = opened.result.id;
  const base: PaneGroup = group ?? { axis: options.axis ?? 'row', panes: [{ id: slot(1), session: beside ?? made }], ratios: [1], active: slot(1), seq: 1 };
  const named = options.beside === undefined ? -1 : base.panes.findIndex((pane) => pane.session === options.beside);
  const after = named >= 0 ? named : Math.max(0, base.panes.findIndex((pane) => pane.id === base.active));
  const pane = { id: slot(base.seq + 1), session: made };
  const panes = [...base.panes.slice(0, after + 1), pane, ...base.panes.slice(after + 1)];
  const next = patch(opened.state, {
    open: true,
    tool: id,
    active: Object.freeze({ ...opened.state.active, [id]: made }),
    panes: Object.freeze({ ...opened.state.panes, [id]: Object.freeze({ axis: base.axis, panes: Object.freeze(panes), ratios: Object.freeze(equalRatios(panes.length)), active: pane.id, seq: base.seq + 1 }) }),
  });
  return { state: settle(next), result: { status: 'done', id: made, pane: pane.id } };
}

/** Makes a pane the tool's active one: its session is the tool's session. A pane whose session is hidden cannot be active. The same pane changes nothing. */
export function focusPane(state: PanelState, tool: ToolId, pane: PaneId): Step<PanelResult> {
  const group = groupOf(state, tool);
  const found = group?.panes.find((one) => one.id === pane);
  const session = found === undefined ? undefined : own(state.sessions, found.session);
  if (group === undefined || found === undefined || session === undefined || !sessionVisible(state, session)) {
    return refuse(state, 'missing', `There is no pane ${pane} in ${tool}.`);
  }

  if (group.active === pane && own(state.active, tool) === found.session) {
    return unchanged(state);
  }

  const next = patch(state, {
    active: Object.freeze({ ...state.active, [tool]: found.session }),
    panes: Object.freeze({ ...state.panes, [tool]: Object.freeze({ ...group, active: pane }) }),
  });
  return { state: settle(next), result: DONE };
}

/** The group and its minimum for a length, or the reason there is none. */
function sized(state: PanelState, tool: ToolId, extent: number): { readonly group: PaneGroup; readonly min: number } | Step<PanelResult> {
  if (!usable(extent)) {
    return refuse(state, 'invalid', 'The shares of panes are read against the length of the panel in pixels.');
  }

  const group = groupOf(state, tool);
  return group === undefined ? refuse(state, 'missing', `${tool} shows one session: it has no panes.`) : { group, min: minRatio(extent, group.panes.length) };
}

const withShares = (state: PanelState, tool: ToolId, group: PaneGroup, ratios: readonly number[]): Step<PanelResult> =>
  sameShares(ratios, group.ratios) ? unchanged(state) : { state: patch(state, { panes: Object.freeze({ ...state.panes, [tool]: Object.freeze({ ...group, ratios: Object.freeze(ratios) }) }) }), result: DONE };

/**
 * The sash between pane `boundary` and the next is dragged to `position`, a share of the whole. The shares are first brought within the minimum of `extent` (what a window made narrower needs), then the two
 * panes beside the sash share what they had, neither below it; the other panes do not move. A position past either end stops at the minimum.
 */
export function moveSash(state: PanelState, tool: ToolId, boundary: number, position: number, extent: number): Step<PanelResult> {
  const found = sized(state, tool, extent);
  if ('state' in found) {
    return found;
  }

  const { group, min } = found;
  if (!Number.isInteger(boundary) || boundary < 0 || boundary + 1 >= group.panes.length || Number.isNaN(position)) {
    return refuse(state, 'invalid', 'A sash is between two panes, and is dragged to a position.');
  }

  return withShares(state, tool, group, moveBoundary(fitRatios(group.ratios, min), boundary, position, min));
}

/** Every pane the same share (a double click on a sash). Nothing changes when they are. */
export function equalisePanes(state: PanelState, tool: ToolId, extent: number): Step<PanelResult> {
  const found = sized(state, tool, extent);
  return 'state' in found ? found : withShares(state, tool, found.group, equalRatios(found.group.panes.length));
}

/** The panel is `extent` long: shares below the minimum for it are brought within it and stay so, as `fitHeight` does for the height. */
export function fitPanes(state: PanelState, tool: ToolId, extent: number): Step<PanelResult> {
  const found = sized(state, tool, extent);
  return 'state' in found ? found : withShares(state, tool, found.group, fitRatios(found.group.ratios, found.min));
}

/** How the keyboard moves between the panes of a group. */
export type PaneStep = 'next' | 'previous' | 'left' | 'right' | 'up' | 'down';

export function paneToward(_layout: PaneLayout, _step: PaneStep): PaneId | undefined {
  return undefined;
}

export function leavePane(state: PanelState, _session: SessionId): Step<PanelResult> {
  return unchanged(state);
}
