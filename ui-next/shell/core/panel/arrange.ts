import { limitsOf, MIN_HEIGHT } from './height';
import { effectiveTool, own, patch, refuse, sessionVisible, settle, toolVisible, unchanged, type Step } from './state';
import type { PanelResult, PanelState, Resize, SessionId, ToolId } from './types';

// What the user does to the panel itself: show and hide it, size it, choose a tool, choose a session. Each is a function from a state to a state; one that changes nothing returns the
// same state.

const DONE: PanelResult = Object.freeze({ status: 'done' });

/** The most a remembered height is: a sanity bound, not a limit of any window (the window clamps where the height is drawn). */
const MAX_REMEMBERED = 10_000;

export type ShowOptions = {
  /** Puts this tool on screen as well. A tool that is not visible is ignored: the panel opens on the tool it had. */
  readonly tool?: ToolId | undefined;
};

/** Opens the panel, on a tool when one is named (the chord, the toggle and the command that shows a tool). */
export function show(state: PanelState, options: ShowOptions = {}): Step<PanelResult> {
  const named = options.tool === undefined ? undefined : own(state.tools, options.tool);
  // Opening makes the tool on screen the user's: a tool that a plugin registers afterwards, and that sorts before it, must not take the panel from under them.
  const tool = named !== undefined && toolVisible(state, named) ? named.id : state.open ? state.tool : (state.tool ?? effectiveTool(state));
  if (state.open && tool === state.tool) {
    return unchanged(state);
  }

  return { state: settle(patch(state, { open: true, tool })), result: DONE };
}

export function hide(state: PanelState): Step<PanelResult> {
  return state.open ? { state: settle(patch(state, { open: false })), result: DONE } : unchanged(state);
}

/** Sets the remembered height, `null` for the default. */
export function setHeight(state: PanelState, height: number | null): Step<PanelResult> {
  if (height !== null && !Number.isFinite(height)) {
    return refuse(state, 'invalid', 'A height is a number of pixels.');
  }

  const next = height === null ? null : Math.min(MAX_REMEMBERED, Math.max(MIN_HEIGHT, Math.round(height)));
  return next === state.height ? unchanged(state) : { state: patch(state, { height: next }), result: DONE };
}

/** What the splitter's release or key says: a size, or hide (a release below two thirds of the minimum). Hiding keeps the height the panel had (S101: one remembered size). */
export function resize(state: PanelState, change: Resize): Step<PanelResult> {
  return 'collapse' in change ? hide(state) : setHeight(state, change.size);
}

/**
 * The window changed height, or the panel was read in one: a remembered size that does not fit it is brought within the window's limits, and the size that fits is what is remembered. The mock
 * does the same, on load and on every resize (shell-core.js `panelClamp` of `layout.<window>.panel`, S103), so a window made smaller and larger again keeps the smaller panel. The default
 * (`null`) follows the window by itself and has nothing to fit. Nothing to do for a window that says nothing (`viewport` not a number, or no height).
 */
export function fitHeight(state: PanelState, viewport: number): Step<PanelResult> {
  if (state.height === null || !(viewport > 0)) {
    return unchanged(state);
  }

  const { min, max } = limitsOf(viewport);
  const fitted = Math.min(max, Math.max(min, state.height));
  return fitted === state.height ? unchanged(state) : { state: patch(state, { height: fitted }), result: DONE };
}

/** Puts a tool on its tab as the one the user chose. It does not open the panel. */
export function activateTool(state: PanelState, id: ToolId): Step<PanelResult> {
  const tool = own(state.tools, id);
  if (tool === undefined || !toolVisible(state, tool)) {
    return refuse(state, 'missing', `There is no tool ${id}.`);
  }

  if (state.tool === id && effectiveTool(state) === id) {
    return unchanged(state);
  }

  return { state: settle(patch(state, { tool: id })), result: DONE };
}

/** Chooses a session: its tool comes on screen and it is its tool's session. A session that is hidden, or not there, is refused. It does not open the panel. */
export function activateSession(state: PanelState, id: SessionId): Step<PanelResult> {
  const session = own(state.sessions, id);
  if (session === undefined || !sessionVisible(state, session)) {
    return refuse(state, 'missing', `There is no session ${id}.`);
  }

  if (state.tool === session.tool && own(state.active, session.tool) === id) {
    return unchanged(state);
  }

  return { state: settle(patch(state, { tool: session.tool, active: Object.freeze({ ...state.active, [session.tool]: id }) })), result: DONE };
}
