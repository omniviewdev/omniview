import type { ToolBadge } from '../badge';
import type { Subject } from '../subject';

// What the Problems tool lists (ch16 S74, S121): the CONDITIONS that are true now. A condition is not a record: it has no unread state, no history and nothing to clear. It is in the list for exactly as long as its
// producer says it is true, and it goes the moment the producer stops saying so. The tool knows no plugin and no product: a producer (the host's adapters, `plugins/host/conditions.ts`) states each fact in these words.

/** How bad it is, in the three steps the tool orders and counts by. Only an error is counted on the tab as a number; a warning is a dot (S114), and an info is never on the tab. */
export type Severity = 'error' | 'warning' | 'info';

export type Condition = {
  /** Unique across every producer and the same for as long as the condition lasts: it is the row's identity. Each producer prefixes its keys with its own word, so two producers never share one. */
  readonly key: string;
  readonly severity: Severity;
  /** The Condition column's word. The model does not clip it: the cell does, with an ellipsis. */
  readonly label: string;
  /** The full sentence: the tooltip of the Condition cell, and what a screen reader reads of the row. */
  readonly title: string;
  /** The plugin it comes from, as a person reads it. */
  readonly source: { readonly id: string; readonly name: string };
  /** What it is about: a connection's name, or the plugin's own name. `undefined` when it is about nothing in particular (the Target column says so). */
  readonly target: string | undefined;
  /** Where the row goes (`../subject`), or `undefined` when the condition has no page of its own. */
  readonly subject: Subject | undefined;
};

/** How many conditions of each severity are listed. */
export type ProblemCounts = { readonly error: number; readonly warning: number; readonly info: number };

/**
 * What the tool reads. Every member keeps its identity while it says the same: the rows are the same array until a row came, went or changed, a row that did not change is the very object it was, and `counts` and `badge` are the same
 * objects while their numbers and words are. A view that reads one member therefore renders only when that member changed.
 */
export type ProblemsSnapshot = {
  /** Severity descending, then source, then target (none last), then key. */
  readonly rows: readonly Condition[];
  readonly counts: ProblemCounts;
  /** What the tool's tab carries (S114): the errors as a count; with no error, the warnings as a dot; else nothing. */
  readonly badge: ToolBadge | undefined;
};

export type Problems = {
  /** The same object until something in it changes. */
  readonly getSnapshot: () => ProblemsSnapshot;
  /** Called once after each `set` that changed what the tool says, and never for one that did not. Answers the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Replaces what ONE producer says is true now: a condition that is not in its list is gone at once, and a list that says what the producer said before changes nothing and tells nobody. What the other producers say is
   * not touched. A key that appears twice in the list is its first condition.
   */
  readonly set: (producer: string, conditions: readonly Condition[]) => void;
};
