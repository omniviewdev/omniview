import { Icon, Text } from '@omniviewdev/kit';
import { useLayoutEffect, useState, type KeyboardEvent } from 'react';
import { countText, type CountText } from './core/count';
import type { ModifierEvent } from './core/tabs';
import { expandedIds, hasNode, press, revealed, stopOf, toggled, visibleRows, type TreeMemory } from './core/tree';
import type { ShellAccent, ShellCount, ShellTreeNode } from './registration';
import styles from './Tree.module.css';

type TreeProps = {
  readonly label: string;
  readonly nodes: readonly ShellTreeNode[];
  /** The groups open at first, and the entry that is current: read once, when the tree mounts. A tree that was on screen before under its key (`memory`) starts where its user left it instead of from `open`. */
  readonly open: readonly string[] | undefined;
  readonly current: string | undefined;
  readonly accent: ShellAccent | undefined;
  /**
   * What the window remembers of its trees, and the key of this one: the tree keeps its record there while it is on screen and recalls it when it mounts, so a sidebar that went away (its plugin stopped and was
   * loaded again, the rail showed another entry) comes back with its groups as they were left. Absent: the tree remembers nothing and always starts from `open` and `current`.
   */
  readonly memory?: TreeMemory | undefined;
  readonly memoryKey?: string | undefined;
  /**
   * An entry (not a group) was chosen, by click, Enter or Space: its id, and the click when it was one (its modifiers pick where the page opens, ch16 S64; a key opens the plain way).
   * What it opens is the host's to decide.
   */
  readonly onChoose: ((id: string, event: ModifierEvent | undefined) => void) | undefined;
  /**
   * The groups that are open on screen, told to the host when the tree mounts and each time they change, and told as none when the tree goes away: the host tells the plugin's sidebar hook, which then asks for the
   * counts of the entries that are on screen and of no others. A group inside a closed group is not told, for none of its entries is on screen. Sorted, so that the same groups are the same list in whatever order they were opened.
   * Absent: nobody listens.
   */
  readonly onOpenChange?: ((open: readonly string[]) => void) | undefined;
};

type RowProps = {
  readonly id: string;
  readonly label: string;
  readonly icon: ShellTreeNode['icon'];
  readonly count: ShellCount | null | undefined;
  readonly level: number;
  readonly position: number;
  readonly setSize: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly isStop: boolean;
  readonly onToggle: (id: string) => void;
  readonly onFocusRow: (id: string) => void;
  readonly onChoose: ((id: string, event: ModifierEvent | undefined) => void) | undefined;
};

/**
 * The count slot (ch12 SB1: every collection row has one): the space at the end of the row that a count is drawn in, held whether or not there is a number in it, so a number that arrives moves no label. The mock's
 * tree draws a count as the last thing in its row, in muted 12 px tabular figures (shell-widgets.css `.tree__count`), and so does this: the digits sit at the row's end, and the slot holds the width of a count beside them.
 * The space before the slot is a text node, not layout: it is ignored by the grid and keeps the row's name "Label 89" wherever the name is computed without CSS.
 *
 * An approximate count is drawn "~89" and named "about 89": what is drawn is hidden from assistive technology, which would say "tilde", and a second text that is not drawn says what it means. The row keeps no
 * `aria-label` of its own, so the name is still the row's content and holds the visible text of the label: an `aria-label` that put "about" where the eye reads "~" fails axe's label-content-name-mismatch (WCAG 2.5.3).
 */
function CountSlot({ text }: { readonly text: CountText | undefined }) {
  return (
    <>
      {' '}
      <span className={styles.count} data-shell-part="count">
        {text === undefined ? null : (
          <Text variant="caption" tone="muted">
            {text.approximate ? (
              <>
                <span aria-hidden="true">{text.text}</span>
                <span className={styles.about}>about {text.digits}</span>
              </>
            ) : (
              text.text
            )}
          </Text>
        )}
      </span>
    </>
  );
}

// A row is named by its text, the label and the count (WCAG 2.5.3: the name contains the visible text), and so a screen reader hears "Label 89", and for an approximate count "Label about 89".
function Row({ id, label, icon, count, level, position, setSize, expandable, expanded, selected, isStop, onToggle, onFocusRow, onChoose }: RowProps) {
  const text = count === undefined ? undefined : countText(count);
  return (
    <li
      role="treeitem"
      className={styles.row}
      style={{ '--_level': level - 1 }}
      data-id={id}
      data-shell-focus={isStop ? '' : undefined}
      tabIndex={isStop ? 0 : -1}
      aria-level={level}
      aria-posinset={position}
      aria-setsize={setSize}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
      onFocus={() => {
        onFocusRow(id);
      }}
      onClick={(event) => {
        if (expandable) {
          onToggle(id);
        } else {
          onChoose?.(id, event);
        }
      }}
    >
      <span className={styles.glyph}>
        <Icon name={icon} />
      </span>
      {/* A name that is cut at its end says its whole name when it is pointed at, and only then (ch12 SB1; the mock's clipped-cell tip): the kit's tooltip measures it when the pointer or the focus arrives. */}
      <span className={styles.label} data-ov-clip="">
        <Text>{label}</Text>
      </span>
      {count === undefined ? null : <CountSlot text={text} />}
      {expandable ? (
        <span className={styles.disclosure}>
          <Icon name="chevron-right" />
        </span>
      ) : null}
    </li>
  );
}

type TreeState = { readonly open: ReadonlySet<string>; readonly stop: string | undefined };

/**
 * The tree view of a sidebar: a roving tab stop on the current entry, the WAI-ARIA tree view keys (core/tree.ts holds every rule), and a
 * click on a group to open or close it. What a user opened or closed lives here, survives the screen registering again, and (with a `memory`) survives the tree going away and coming back: the groups
 * are the user's, and a plugin that stopped and was loaded again, or a rail that went to another entry and returned, shows them as they were left.
 * Choosing an entry (a click, Enter or Space) tells the host which one; the tree does not move the current entry itself: the host registers the page
 * it opened, and that entry becomes current. Kit part it should become: Tree.
 */
export function Tree({ label, nodes, open, current, accent, memory, memoryKey = label, onChoose, onOpenChange }: TreeProps) {
  const [state, setState] = useState<TreeState>(() => ({ open: memory?.recall(memoryKey)?.open ?? revealed(nodes, open ?? [], current), stop: undefined }));
  // The current entry is never hidden: when it is, or becomes, an entry inside a group that is closed (another tab was activated, the plugin's frame registered after the tree did, or the entry only
  // comes with the nodes the plugin's data hook answers after the page did), its ancestors open, once. What the user opened or closed stays when the same entry registers again, and when the tree
  // comes back after it went away: `shown` is what it last made sure of, so a tree that returns on the same entry opens nothing the user closed.
  const [shown, setShown] = useState(() => {
    const recalled = memory?.recall(memoryKey);
    return recalled === undefined ? (current !== undefined && hasNode(nodes, current) ? current : undefined) : recalled.shown;
  });
  if (current === undefined ? shown !== undefined : shown !== current && hasNode(nodes, current)) {
    setShown(current);
    if (current !== undefined) {
      // What the user opened stays, a group the nodes do not hold yet included: the skeleton of a plugin's sidebar comes before its data.
      setState((before) => ({ ...before, open: new Set([...before.open, ...revealed(nodes, [], current)]) }));
    }
  }

  useLayoutEffect(() => {
    memory?.keep(memoryKey, { open: state.open, shown });
  }, [memory, memoryKey, state.open, shown]);

  const rows = visibleRows(nodes, state.open);
  const stop = stopOf(rows, state.stop, current);

  // What is on screen is told to the host: the key stands for the list, so the host hears of a change of the groups and not of a render. The tree that goes away tells it that nothing is open.
  const expandedKey = JSON.stringify(expandedIds(rows));
  useLayoutEffect(() => {
    onOpenChange?.(JSON.parse(expandedKey) as string[]);
  }, [expandedKey, onOpenChange]);
  useLayoutEffect(
    () => () => {
      onOpenChange?.([]);
    },
    [onOpenChange],
  );

  const onToggle = (id: string) => {
    setState((before) => ({ ...before, open: toggled(before.open, id) }));
  };

  const onFocusRow = (id: string) => {
    setState((before) => (before.stop === id ? before : { ...before, stop: id }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const result = press(rows, state.open, stop, event.key);
    if (!result.handled) {
      return;
    }

    event.preventDefault();
    setState({ open: result.open, stop: result.stop });
    if (result.activate !== undefined) {
      onChoose?.(result.activate, undefined);
    }

    if (result.stop !== undefined && result.stop !== stop) {
      const row = [...event.currentTarget.children].find((child) => child instanceof HTMLElement && child.dataset.id === result.stop);
      if (row instanceof HTMLElement) {
        row.focus();
      }
    }
  };

  return (
    <ul role="tree" aria-label={label} className={styles.tree} data-accent={accent} onKeyDown={onKeyDown}>
      {rows.map((row) => (
        <Row
          key={row.id}
          id={row.id}
          label={row.node.label}
          icon={row.node.icon}
          count={row.node.count}
          level={row.level}
          position={row.position}
          setSize={row.setSize}
          expandable={row.expandable}
          expanded={row.expanded}
          selected={row.id === current}
          isStop={row.id === stop}
          onToggle={onToggle}
          onFocusRow={onFocusRow}
          onChoose={onChoose}
        />
      ))}
    </ul>
  );
}
