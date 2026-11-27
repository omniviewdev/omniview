import { unchanged, type Context, type Step } from './state';
import type { PanelResult, PanelState, PaneId, SessionId, SessionInput, SplitResult, ToolId } from './types';

// The panes of a tool: a new session beside the active one, the sash, closing. A tool that has no group shows one session and none of this applies to it.

export type SplitOptions = {
  /** The panel's length along the group's axis in pixels: the layout knows it, the model does not. A pane needs `PANE_MIN_PX` of it. */
  readonly extent: number;
  readonly axis?: 'row' | 'column' | undefined;
};

export function splitPane(state: PanelState, tool: ToolId, input: Omit<SessionInput, 'tool'>, ctx: Context, options: SplitOptions): Step<SplitResult> {
  void tool; void input; void ctx; void options;
  return { state, result: { status: 'refused', reason: 'missing', message: 'not built' } };
}

export function focusPane(state: PanelState, tool: ToolId, pane: PaneId): Step<PanelResult> {
  void tool; void pane;
  return unchanged(state);
}

export function moveSash(state: PanelState, tool: ToolId, boundary: number, position: number, extent: number): Step<PanelResult> {
  void tool; void boundary; void position; void extent;
  return unchanged(state);
}

export function equalisePanes(state: PanelState, tool: ToolId, extent: number): Step<PanelResult> {
  void tool; void extent;
  return unchanged(state);
}

export function fitPanes(state: PanelState, tool: ToolId, extent: number): Step<PanelResult> {
  void tool; void extent;
  return unchanged(state);
}

export type { SessionId };
