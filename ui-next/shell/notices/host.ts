import type { NoticesStore } from '../core/notices';
import { createAnnouncer, type Announcer } from '../palette/host';
import type { Centre } from './centreControl';

// What the shell asks of its host to draw the toast layer (the notices model is ../core/notices; this draws it). The model is the host's: it makes the store with the seam it needs (the tab model's open,
// the commands, what a route can do, the live region below) and hands the shell this. The shell knows no plugin and no producer: it draws the stack's snapshot and calls the store's operations. Plain data
// and functions.

/**
 * The window's two live regions (ch16 S86), the one place a record that has no toast is told to a screen reader: a polite region, and an assertive one for an error of work the user started. A record
 * with a toast is announced by the toast itself, so it is never told here as well (the model decides which, `core/notices/README.md`, "Live-region rules"). The same text told twice in a row is two
 * announcements: each is its own serial.
 */
export type NoticesAnnouncer = {
  /** The model's `announce` seam: `NoticesOptions.announce`. */
  readonly announce: (text: string, options: { readonly urgent: boolean }) => void;
  readonly polite: Announcer;
  readonly assertive: Announcer;
};

export function createNoticesAnnouncer(): NoticesAnnouncer {
  const polite = createAnnouncer();
  const assertive = createAnnouncer();
  return {
    announce: (text, { urgent }) => {
      (urgent ? assertive : polite).announce(text);
    },
    polite,
    assertive,
  };
}

export type NoticesBindings = {
  readonly store: NoticesStore;
  readonly announcer: NoticesAnnouncer;
  /**
   * The window's notification centre (`centre.ts`): the bell in the status bar and the popover of history it opens, and the summary toast's Show (S79), which asks the store, and so the host's `openCenter`, which is
   * this. The host makes it with the store (`createCentre`) and hands the same one to both. Absent: the window has no bell and no centre, and the summary says how many more there are and has no button, because a
   * button that does nothing is a stub.
   */
  readonly centre?: Centre | undefined;
};
