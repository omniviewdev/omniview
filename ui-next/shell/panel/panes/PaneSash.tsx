import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { type PaneAxis, type SessionId, type ToolId } from '../../core/panel';
import { usePanel } from '../context';
import { bodyId } from '../words';
import { measure } from './geometry';
import styles from './PaneSash.module.css';
import { boundaryOf, createSash } from './sash';

type PaneSashProps = {
  /** The deck the sash divides: the element that holds the bodies and the sashes. */
  readonly deck: RefObject<HTMLElement | null>;
  readonly tool: ToolId;
  readonly axis: PaneAxis;
  /** The pane before the sash, among the panes drawn. */
  readonly boundary: number;
  /** The sessions of the panes drawn, in order, and their shares. */
  readonly sessions: readonly SessionId[];
  readonly ratios: readonly number[];
  readonly prefix: string;
};

/** The element of a session's body in the deck: the sash writes to the two beside it and to nothing else. */
const slotOf = (deck: HTMLElement | null, session: SessionId): HTMLElement | null =>
  deck === null ? null : ([...deck.querySelectorAll<HTMLElement>(':scope > [data-session-id]')].find((slot) => slot.getAttribute('data-session-id') === session) ?? null);

/**
 * The sash between two panes: a separator with a hit area wider than its line, a Tab stop, a drag (`./sash.ts`: one frame writes the two panes' `flex-grow`, the model is told once on release), the arrow keys (16 px, 64 with Shift), Home
 * and End, Enter and a double click to share the room equally again. Its value is where the line is as a percentage of the room the panes share, and its limits are the minimum a pane may have (80 px).
 */
export function PaneSash({ deck, tool, axis, boundary, sessions, ratios, prefix }: PaneSashProps) {
  const { store } = usePanel();
  // What the controller reads when a gesture starts or a key is pressed: where this sash is NOW. A sash is the one before a pane, so a split or a close puts it between other panes without making another component; the layout effect below
  // keeps this current (a ref written during a render is not allowed, and a closure made once would read the first render's).
  const [live] = useState(() => {
    let current = { tool, axis, boundary, sessions };
    return {
      get: () => current,
      set: (next: typeof current) => {
        current = next;
      },
    };
  });
  const [sash] = useState(() =>
    createSash({
      store,
      place: () => ({ tool: live.get().tool, boundary: live.get().boundary, axis: live.get().axis }),
      geometry: () => (deck.current === null ? null : measure(deck.current, live.get().axis, live.get().sessions.length)),
      panes: (at) => [slotOf(deck.current, live.get().sessions[at]), slotOf(deck.current, live.get().sessions[at + 1])],
      marked: () => deck.current?.closest<HTMLElement>('[data-shell-part="window"]') ?? null,
    }),
  );

  // The committed shares are drawn: what a drag wrote is given back to the stylesheet in the commit that draws them, so the panes never show the old shares between the two.
  useLayoutEffect(() => {
    live.set({ tool, axis, boundary, sessions });
    sash.release();
  }, [live, sash, tool, axis, boundary, sessions, ratios]);

  useEffect(
    () => () => {
      sash.dispose();
    },
    [sash],
  );

  const percent = (value: number): number => Math.round(value * 100);
  return (
    <div
      className={styles.sash}
      role="separator"
      aria-orientation={axis === 'column' ? 'horizontal' : 'vertical'}
      aria-label={`Resize panes ${String(boundary + 1)} and ${String(boundary + 2)}`}
      aria-controls={`${bodyId(prefix, sessions[boundary])} ${bodyId(prefix, sessions[boundary + 1])}`}
      aria-valuenow={percent(boundaryOf(ratios, boundary))}
      aria-valuetext={`Pane ${String(boundary + 1)} is ${String(percent(ratios[boundary]))} percent`}
      tabIndex={0}
      data-shell-part="paneSash"
      data-axis={axis}
      data-boundary={boundary}
      style={{ '--_order': String(2 * boundary + 1) }}
      onPointerDown={sash.pointerDown}
      onPointerMove={sash.pointerMove}
      onPointerUp={sash.pointerUp}
      onPointerCancel={sash.cancel}
      onLostPointerCapture={sash.cancel}
      onKeyDown={sash.key}
      onDoubleClick={sash.reset}
    />
  );
}
