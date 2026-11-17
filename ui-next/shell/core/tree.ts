// The sidebar's tree as plain functions over data: which rows are visible, which row holds the one tab stop, and what a key does.
// No React and no DOM: every rule is a unit test, and a renderer only draws the answers (ui-next/shell/README.md, "The core").
//
// Shape of the answers, from the design: a flat list of rows with a level (the mock's `H.tree`, ch12 SB1), the WAI-ARIA tree view keys
// (the mock's controller, shell-widgets.js), one tab stop (a roving tabindex), and a state that is the same object when nothing changed.
// Not built yet: type-ahead, PageUp and PageDown, and the windowing and chunked expand-all a catalog of thousands of nodes needs
// (docs/ui-next/optimisations.md LIB-10 to LIB-15). Rows are plain data and `visibleRows` is O(visible rows), so none of it is foreclosed.

/** What the core needs of a node: an id, and children when it is a group. A screen's own node type is richer; each row hands it back untouched. */
export type TreeShape<Node> = { readonly id: string; readonly children?: readonly Node[] };
export type TreeLike = { readonly id: string; readonly children?: readonly TreeLike[] };

/** One visible row, with what a tree item announces. */
export type TreeRow<Node extends TreeShape<Node> = TreeLike> = {
  readonly node: Node;
  readonly id: string;
  /** 1 for a root: `aria-level`. */
  readonly level: number;
  readonly parent: string | undefined;
  /** A group: a node with children. Only groups open and close. */
  readonly expandable: boolean;
  readonly expanded: boolean;
  /** Size of the row's set of siblings, and its 1-based place in it: `aria-setsize` and `aria-posinset`. */
  readonly setSize: number;
  readonly position: number;
};

/** The rows on screen, in order: every root, and the children of each open group. One pass over what is visible. */
export function visibleRows<Node extends TreeShape<Node>>(nodes: readonly Node[], open: ReadonlySet<string>): TreeRow<Node>[] {
  const rows: TreeRow<Node>[] = [];
  const walk = (siblings: readonly Node[], level: number, parent: string | undefined): void => {
    siblings.forEach((node, index) => {
      const expandable = (node.children?.length ?? 0) > 0;
      const expanded = expandable && open.has(node.id);
      rows.push({ node, id: node.id, level, parent, expandable, expanded, setSize: siblings.length, position: index + 1 });
      if (expanded && node.children !== undefined) {
        walk(node.children, level + 1, node.id);
      }
    });
  };
  walk(nodes, 1, undefined);
  return rows;
}

/**
 * The groups open at first: the ones the screen asked for that are groups, and every ancestor of `current`, so the current entry is
 * never hidden at load. Runs once per tree, not per render.
 */
export function revealed<Node extends TreeShape<Node>>(nodes: readonly Node[], open: Iterable<string>, current: string | undefined): ReadonlySet<string> {
  const groups = new Set<string>();
  let ancestors: readonly string[] = [];
  const visit = (siblings: readonly Node[], path: readonly string[]): void => {
    for (const node of siblings) {
      if (node.id === current) {
        ancestors = path;
      }

      if (node.children !== undefined && node.children.length > 0) {
        groups.add(node.id);
        visit(node.children, [...path, node.id]);
      }
    }
  };
  visit(nodes, []);

  const result = new Set<string>();
  for (const id of open) {
    if (groups.has(id)) {
      result.add(id);
    }
  }

  for (const id of ancestors) {
    result.add(id);
  }

  return result;
}

/** The open set after opening or closing one group. The set it was given when nothing changes, so a no-op is no new state. */
export function toggled(open: ReadonlySet<string>, id: string, force?: boolean): ReadonlySet<string> {
  const want = force ?? !open.has(id);
  if (want === open.has(id)) {
    return open;
  }

  const next = new Set(open);
  if (want) {
    next.add(id);
  } else {
    next.delete(id);
  }

  return next;
}

/** The row that holds the tree's one tab stop: the stop if it is still a row, else the current entry, else the first row. */
export function stopOf<Node extends TreeShape<Node>>(rows: readonly TreeRow<Node>[], stop: string | undefined, current: string | undefined): string | undefined {
  const isRow = (id: string | undefined) => id !== undefined && rows.some((row) => row.id === id);
  if (isRow(stop)) {
    return stop;
  }

  return isRow(current) ? current : rows[0]?.id;
}

/** What a key did. `handled` says whether the tree owns the key (the caller then prevents the browser's default); `activate` is an entry chosen with Enter or Space. */
export type KeyResult = {
  readonly handled: boolean;
  readonly open: ReadonlySet<string>;
  readonly stop: string | undefined;
  readonly activate: string | undefined;
};

/**
 * One key on the tree, with the stop where it is. The keys are the WAI-ARIA tree view's: Down and Up move the stop, Home and End jump,
 * Right opens a group and then enters it, Left closes an open group and then goes to the parent, Enter and Space open or close a group
 * and choose an entry. The opened set is the one given unless a group opened or closed.
 */
export function press<Node extends TreeShape<Node>>(rows: readonly TreeRow<Node>[], open: ReadonlySet<string>, stop: string | undefined, key: string): KeyResult {
  const at = rows.findIndex((row) => row.id === stop);
  const row = rows[at];
  const ignored: KeyResult = { handled: false, open, stop, activate: undefined };
  if (row === undefined) {
    return ignored;
  }

  const to = (target: TreeRow<Node> | undefined): KeyResult => ({ handled: true, open, stop: (target ?? row).id, activate: undefined });
  switch (key) {
    case 'ArrowDown':
      return to(rows[Math.min(at + 1, rows.length - 1)]);
    case 'ArrowUp':
      return to(rows[Math.max(at - 1, 0)]);
    case 'Home':
      return to(rows[0]);
    case 'End':
      return to(rows.at(-1));
    case 'ArrowRight':
      return row.expandable && !row.expanded ? { ...to(row), open: toggled(open, row.id, true) } : to(row.expandable ? rows[at + 1] : row);
    case 'ArrowLeft':
      return row.expanded ? { ...to(row), open: toggled(open, row.id, false) } : to(rows.find((candidate) => candidate.id === row.parent));
    case 'Enter':
    case ' ':
      return row.expandable ? { ...to(row), open: toggled(open, row.id) } : { ...to(row), activate: row.id };
    default:
      return ignored;
  }
}
