import type { ToolBadge } from '../badge';
import type { Subject } from '../subject';
import type { Condition, ProblemCounts, Problems, ProblemsSnapshot, Severity } from './types';

// The model of the Problems tool (ch16 S74, S121). A CONDITION is true now: it has no record, no unread state and nothing to clear, and it is listed for exactly as long as its producer says it is true. So the one way in is
// `set(producer, list)`, which replaces what ONE producer says: what is not in the list is gone at once, and what the other producers say is left alone. Framework-free, with no timer of its own: React reads it through
// `useSyncExternalStore` (`getSnapshot` is the same object until something in it changes), and the host's adapters (`plugins/host/conditions.ts`) call `set` whenever a producer says it changed.
//
// WHAT THE VIEW READS KEEPS ITS IDENTITY while it says the same. A producer builds its conditions anew on every `set` (it has no object to give back), so the model compares them member by member and keeps the object it
// already shows for an equal one: the table's rows render again only when their own object changed, so one condition that changes is one row that renders, and a `set` that says what was said renders nothing and tells
// nobody. The rows, `counts` and `badge` are one object each for as long as they say the same, so a tab that reads only the badge does not render for a change of the rows that leaves the badge as it was.
//
// TWO PRODUCERS THAT SAY ONE KEY. Producers prefix their keys with their own word (`plugin:`, `connection:`, `alert:`), so this does not happen, and the rule here is only to make it harmless when a producer gets it wrong. A key is
// shown once, as the producer that began to say it LAST says it. When a producer began to say it is when its list first held the key, not when it last held it again: a producer that lists a key it already listed does not take it
// from a producer that began later (it would flap with every `set`), and one that drops the key and lists it again has begun anew. A producer that stops saying a key leaves it to the one that still says it, because what a
// producer said stays true until the producer says otherwise (S74), so the list does not hide what some producer still claims.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Errors first, then warnings, then infos. */
const RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

const raw = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** By name, numbers by value and case ignored; no target after every target. */
function byTarget(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) {
    return a === b ? 0 : a === undefined ? 1 : -1;
  }

  return collator.compare(a, b);
}

/** Severity descending, then the source's name, then the target (none last), then the key: texts that differ only in case still have one order, and keys are unique, so the order is a function of the set and never of how it arrived. */
function compare(a: Condition, b: Condition): number {
  return RANK[a.severity] - RANK[b.severity] || collator.compare(a.source.name, b.source.name) || byTarget(a.target, b.target) || raw(a.key, b.key);
}

function sameSubject(a: Subject | undefined, b: Subject | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }

  if (a.kind === 'plugin') {
    return b.kind === 'plugin' && a.plugin === b.plugin;
  }

  return b.kind === 'connection' && a.plugin === b.plugin && a.connection === b.connection;
}

/** Equal in every member, nested ones by value: what a producer builds anew each time is the condition it built before. */
function same(a: Condition, b: Condition): boolean {
  return (
    a === b ||
    (a.key === b.key &&
      a.severity === b.severity &&
      a.label === b.label &&
      a.title === b.title &&
      a.source.id === b.source.id &&
      a.source.name === b.source.name &&
      a.target === b.target &&
      sameSubject(a.subject, b.subject))
  );
}

/** One condition a producer says, and when the producer began to say it (a sequence number of the model: the greater began later). */
type Claim = { readonly condition: Condition; readonly began: number };

/**
 * What one producer says, by key: its list with a key that appears twice read once (the first wins), a claim that is the one the producer already had when its condition is equal (so a `set` that says the same is
 * recognised by identity), and, for a key the producer already said, the time it began to say it (`began`).
 */
function claimed(before: ReadonlyMap<string, Claim> | undefined, conditions: readonly Condition[], begin: () => number): Map<string, Claim> {
  const claims = new Map<string, Claim>();
  for (const condition of conditions) {
    if (claims.has(condition.key)) {
      continue;
    }

    const held = before?.get(condition.key);
    claims.set(condition.key, held !== undefined && same(held.condition, condition) ? held : { condition, began: held?.began ?? begin() });
  }

  return claims;
}

function sameClaims(a: ReadonlyMap<string, Claim>, b: ReadonlyMap<string, Claim>): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const [key, claim] of b) {
    if (a.get(key) !== claim) {
      return false;
    }
  }

  return true;
}

const tally = (rows: readonly Condition[]): ProblemCounts => {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const row of rows) {
    if (row.severity === 'error') {
      error += 1;
    } else if (row.severity === 'warning') {
      warning += 1;
    } else {
      info += 1;
    }
  }

  return { error, warning, info };
};

const sameCounts = (a: ProblemCounts, b: ProblemCounts): boolean => a.error === b.error && a.warning === b.warning && a.info === b.info;

const noun = (count: number, one: string): string => `${String(count)} ${count === 1 ? one : `${one}s`}`;

/** The tab's badge (S114; the mock, shell-panel.js 2511): the errors as a count; with no error, the warnings as a dot; an info never. Each says its words, because the tab's name carries them. */
function badgeOf({ error, warning }: ProblemCounts): ToolBadge | undefined {
  if (error > 0) {
    return { kind: 'count', count: error, label: noun(error, 'error') };
  }

  return warning > 0 ? { kind: 'dot', tone: 'warning', label: noun(warning, 'warning') } : undefined;
}

function sameBadge(a: ToolBadge | undefined, b: ToolBadge | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }

  if (a.kind === 'count') {
    return b.kind === 'count' && a.count === b.count && a.label === b.label;
  }

  return b.kind === 'dot' && a.tone === b.tone && a.label === b.label;
}

const NOTHING: ProblemsSnapshot = { rows: [], counts: { error: 0, warning: 0, info: 0 }, badge: undefined };

export function createProblems(): Problems {
  const listeners = new Set<() => void>();
  /** What each producer says now. A producer that says nothing is not in it. */
  const producers = new Map<string, ReadonlyMap<string, Claim>>();
  let clock = 0;
  let snapshot = NOTHING;
  /** The objects of `snapshot.rows`, by key: what an equal condition is given back as. */
  let shown: ReadonlyMap<string, Condition> = new Map();

  const begin = (): number => {
    clock += 1;
    return clock;
  };

  const notify = (): void => {
    // A listener that an earlier one stopped is not told: once its stop function has returned, it hears nothing.
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) {
        listener();
      }
    }
  };

  const set = (producer: string, conditions: readonly Condition[]): void => {
    const before = producers.get(producer);
    const says = claimed(before, conditions, begin);
    if (before === undefined ? says.size === 0 : sameClaims(before, says)) {
      return;
    }

    if (says.size === 0) {
      producers.delete(producer);
    } else {
      producers.set(producer, says);
    }

    // Each key as the producer that began to say it last says it.
    const winners = new Map<string, Claim>();
    for (const claims of producers.values()) {
      for (const claim of claims.values()) {
        const held = winners.get(claim.condition.key);
        if (held === undefined || claim.began > held.began) {
          winners.set(claim.condition.key, claim);
        }
      }
    }

    const rows: Condition[] = [];
    let changed = winners.size !== shown.size;
    for (const [key, { condition }] of winners) {
      const held = shown.get(key);
      const row = held !== undefined && same(held, condition) ? held : condition;
      changed ||= row !== held;
      rows.push(row);
    }

    // Every row is the object already shown, and as many: the same set, so the same order, and nothing to say.
    if (!changed) {
      return;
    }

    rows.sort(compare);
    shown = new Map(rows.map((row): [string, Condition] => [row.key, row]));
    const counts = tally(rows);
    const badge = badgeOf(counts);
    snapshot = {
      rows,
      counts: sameCounts(counts, snapshot.counts) ? snapshot.counts : counts,
      badge: sameBadge(badge, snapshot.badge) ? snapshot.badge : badge,
    };
    notify();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set,
  };
}
