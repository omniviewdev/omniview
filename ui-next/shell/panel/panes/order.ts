import type { SessionId } from '../../core/panel';

// The order of the deck's children in the document. The Tab key walks the document's order, so the panes of a group must lie in it as they lie on screen: pane 1, the sash after it, pane 2, ... (WCAG 2.4.3). A body is never moved
// to get there: the bodies keep the order they were mounted in, and the panes of the group take the places the group's own members hold in it, in the group's order. A split makes a NEW session, which is mounted last and takes the place of
// a member that is after it in the group, so every body that was there keeps its place and the new one is inserted; a close removes one. Each sash is keyed by the pane it comes before, so it follows that pane when a split puts another before it.

export type DeckItem = { readonly kind: 'body'; readonly session: SessionId } | { readonly kind: 'sash'; readonly session: SessionId; readonly boundary: number };

/**
 * What the deck draws, in the document's order: every mounted body, and for a group of panes (`panes`, in the group's order; empty or one for a tool that shows one session) the sash before each pane after the first. The mounted bodies
 * that are not in the group stay where they are.
 */
export function deckOrder(mounted: readonly SessionId[], panes: readonly SessionId[]): readonly DeckItem[] {
  const group = panes.filter((one) => mounted.includes(one));
  if (group.length < 2) {
    return mounted.map((session) => ({ kind: 'body', session }));
  }

  const members = new Set(group);
  const queue = [...group];
  const items: DeckItem[] = [];
  for (const session of mounted) {
    if (!members.has(session)) {
      items.push({ kind: 'body', session });
      continue;
    }

    const next = queue.shift();
    if (next === undefined) {
      continue;
    }

    if (next !== group[0]) {
      items.push({ kind: 'sash', session: next, boundary: group.indexOf(next) - 1 });
    }

    items.push({ kind: 'body', session: next });
  }

  return items;
}
