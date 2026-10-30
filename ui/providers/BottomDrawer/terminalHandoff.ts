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
