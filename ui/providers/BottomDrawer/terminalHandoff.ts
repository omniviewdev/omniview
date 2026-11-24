import { ExecClient } from '@omniviewdev/runtime/api';
import { isPendingDrawerTab } from './drawerSlot';

/**
 * Terminal sessions this window handed to another window.
 *
 * A terminal tab that moves to another window unmounts here while the target
 * mounts it and calls `AttachSession`. The backend keeps a single attached
 * flag per session, so a `DetachSession` from this window landing after the
 * target attached would silence the target's output. The unmounting terminal
 * consumes the mark and skips its detach.
 *
 * Module state is per window: every window is its own document.
 */
const handedOffTerminalSessionIds = new Set<string>();

export function markTerminalSessionHandedOff(sessionId: string): void {
  handedOffTerminalSessionIds.add(sessionId);
}

/** Returns whether the session was handed off, and forgets the mark. */
export function consumeTerminalSessionHandoff(sessionId: string): boolean {
  return handedOffTerminalSessionIds.delete(sessionId);
}

/** What the offer reads of a drawer tab; a serialized tab that a drag carries has the same fields. */
type OfferableTab = { id: string; variant: string; properties?: Record<string, unknown> };

/**
 * Whether a drawer tab is a terminal that has a live session to offer. A
 * `pending-` terminal has no session yet. A tab whose status is `expired` kept
 * its place in the drawer, but its session is gone: there is nothing to offer,
 * and it moves as any tab does.
 */
export function hasTerminalSessionToOffer(tab: OfferableTab): boolean {
  return tab.variant === 'terminal' && !isPendingDrawerTab(tab) && tab.properties?.status !== 'expired';
}

/**
 * Offers the session of a terminal tab that is about to move to another window.
 *
 * A session belongs to the window that opened it, and another window cannot
 * attach it (docs/ui-next/status/T2c-go.md). The window that moves the tab
 * offers the session first, so that the window that mounts the tab and attaches
 * the session, within a minute, holds it from then on. A tab that has no
 * session to offer is not a reason to stop. A failed offer rejects with the
 * error of the host (the session ended, or this window does not hold it), and
 * the caller must not move the tab: the target could not attach the session,
 * and the tab would be gone from this window with its session still running.
 */
export async function offerTerminalSession(tab: OfferableTab): Promise<void> {
  if (!hasTerminalSessionToOffer(tab)) {
    return;
  }

  await ExecClient.OfferSession(tab.id);
}

/**
 * Takes back the offer of {@link offerTerminalSession} when the tab did not move
 * after all (the drop was refused or failed, or the window that was to receive
 * the tab could not be opened or reached). An offer that stays open is open for
 * a minute to any window that knows the session id.
 *
 * It runs in a failure path and never rejects: a failed revoke is logged, and
 * the offer runs out by itself.
 */
export async function revokeTerminalSession(tab: OfferableTab): Promise<void> {
  if (!hasTerminalSessionToOffer(tab)) {
    return;
  }

  try {
    await ExecClient.RevokeSession(tab.id);
  } catch (error) {
    console.warn('[terminal] could not take back the offer of a session; it runs out by itself', tab.id, error);
  }
}
