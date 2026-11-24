import type { ToolId } from '../core/panel';

// What a tool tab carries beside its words (ch16 S114: "a count on a tab is allowed (ch 13 N4); Problems shows its error count, Operations a dot when an unread failure exists"). The panel's model does not hold it: it is a
// fact of the tool's own model (the conditions, the operations), so the host hands the strip a source of badges (`PanelBindings.badges`) and each tab reads its own.

/** A count, or a dot: both with the words that name them, because the tab's accessible name is its words and the badge's ("Problems, 2 errors"), never a bare number. */
export type ToolBadge =
  | { readonly kind: 'count'; readonly count: number; readonly label: string }
  | { readonly kind: 'dot'; readonly tone: 'error' | 'warning'; readonly label: string };

/**
 * Where the strip reads its badges. `of` answers the same object while a tool's badge says the same, so a tab renders only when its own badge changed; `subscribe` tells the strip that some badge may have changed
 * (a tab is told for every change of any tool and renders for its own).
 */
export type ToolBadges = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly of: (tool: ToolId) => ToolBadge | undefined;
};
