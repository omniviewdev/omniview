/**
 * Where a page keeps what the person chose, for the host to give back when the page is drawn again: plain data (it goes through JSON), held by the host for the tab the page is in. The page reads it once,
 * when it opens, and writes it when the person chooses; a page that is given none keeps what it holds only while it is mounted. In the window it is the tab's `pageState`, which survives a reload of the
 * tab, the closing and reopening of the tab and a page the keep-alive cap let go, and which the tab's history keeps with the entry the page is left at: Back and Forward give it back, and a navigation to a
 * place the tab has been at opens as it was left, except where it was scrolled (`shell/core/tabs/README.md`, H7). It is never saved to disk, and at most 16 KiB: a write over that is refused and the host keeps what it held.
 */
export type PageMemory = {
  /** What the host holds for the page now. Anything may be in it: a page reads the parts it wrote and nothing else. */
  readonly read: () => unknown;
  /** Replaces what the host holds. A page that keeps one part keeps the others in the value it writes. */
  readonly write: (value: unknown) => void;
};
