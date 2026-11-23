import { ExecClient } from '@omniviewdev/runtime/api';
import { isTerminalSessionTab } from './drawerSlot';

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

/**
 * Offers the session of a terminal tab that is about to move to another window.
 *
 * A session belongs to the window that opened it, and another window cannot
 * attach it (docs/ui-next/status/T2c-go.md). The window that moves the tab
 * offers the session first, so that the window that mounts the tab and
 * attaches the session, within a minute, holds it from then on. A tab that is
 * not a session of a terminal has nothing to offer. A failed offer does not
 * stop the move: the session may have ended, and this window still holds what
 * it holds.
 */
export async function offerTerminalSession(tab: Parameters<typeof isTerminalSessionTab>[0]): Promise<void> {
  if (!isTerminalSessionTab(tab)) {
    return;
  }

  try {
    await ExecClient.OfferSession(tab.id);
  } catch (error) {
    console.warn('[drawer] could not offer the session of a terminal that is moving', tab.id, error);
  }
}
