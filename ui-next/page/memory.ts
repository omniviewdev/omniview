/**
 * Where a page keeps what the person chose, for the host to give back when the page is drawn again: plain data (it goes through JSON), held by the host for the tab the page is in. The page reads it once,
 * when it opens, and writes it when the person chooses; a page that is given none keeps what it holds only while it is mounted. In the window it is the tab's `pageState`, which survives a reload of the
 * tab, the closing and reopening of the tab and a page the keep-alive cap let go, and which the tab model drops when the tab moves to another entry of its history.
 */
export type PageMemory = {
  /** What the host holds for the page now. Anything may be in it: a page reads the parts it wrote and nothing else. */
  readonly read: () => unknown;
  /** Replaces what the host holds. A page that keeps one part keeps the others in the value it writes. */
  readonly write: (value: unknown) => void;
};
