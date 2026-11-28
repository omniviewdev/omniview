import { createContext, useContext } from 'react';

// What a body in a pane may ask of the deck it is in: how long the deck is along its axis (for a split, which needs the real length to know whether another pane fits), and whether another pane fits now. The deck
// provides it (./usePaneDeck.ts); a body drawn anywhere else has none, and its Split says so.

export type PaneRoom = {
  /** The length a new pane's group would share along the axis, in pixels: the deck's, less the sashes it would have with one more pane. Measured when asked. */
  readonly extent: () => number;
  /** Whether one more pane fits: every pane, the new one included, would have its minimum. */
  readonly fits: boolean;
};

const RoomContext = createContext<PaneRoom | null>(null);

export const PaneRoomProvider = RoomContext.Provider;

/** The room of the deck this body is in, or `null` outside one. */
export function usePaneRoom(): PaneRoom | null {
  return useContext(RoomContext);
}

/** Where a body is among the panes of its group: its place (from 0) and how many there are. Provided to each body of a group by the deck, and absent for a tool that shows one session. */
export type PaneSeat = { readonly index: number; readonly count: number };

const SeatContext = createContext<PaneSeat | null>(null);

export const PaneSeatProvider = SeatContext.Provider;

export function usePaneSeat(): PaneSeat | null {
  return useContext(SeatContext);
}
