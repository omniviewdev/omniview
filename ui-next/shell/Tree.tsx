import { Icon, Text } from '@omniviewdev/kit';
import { useState, type KeyboardEvent } from 'react';
import type { ModifierEvent } from './core/tabs';
import { press, revealed, stopOf, toggled, visibleRows } from './core/tree';
import type { ShellAccent, ShellTreeNode } from './registration';
import styles from './Tree.module.css';

type TreeProps = {
  readonly label: string;
  readonly nodes: readonly ShellTreeNode[];
  /** The groups open at first, and the entry that is current: read once, when the tree mounts. */
  readonly open: readonly string[] | undefined;
  readonly current: string | undefined;
  readonly accent: ShellAccent | undefined;
  /**
   * An entry (not a group) was chosen, by click, Enter or Space: its id, and the click when it was one (its modifiers pick where the page opens, ch16 S64; a key opens the plain way).
   * What it opens is the host's to decide.
   */
  readonly onChoose: ((id: string, event: ModifierEvent | undefined) => void) | undefined;
};

type RowProps = {
  readonly id: string;
  readonly label: string;
  readonly icon: ShellTreeNode['icon'];
  readonly count: number | undefined;
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

// A row is named by its text, the label and the count (WCAG 2.5.3: the name contains the visible text). The space between them is a text
// node, not layout: it is ignored by the grid and it keeps the name "Label 89" wherever the name is computed without CSS.
function Row({ id, label, icon, count, level, position, setSize, expandable, expanded, selected, isStop, onToggle, onFocusRow, onChoose }: RowProps) {
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
      <span className={styles.label}>
        <Text>{label}</Text>
      </span>
      {count === undefined ? null : (
        <>
          {' '}
          <span className={styles.count}>
            <Text variant="caption" tone="muted">{count}</Text>
          </span>
        </>
      )}
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
 * click on a group to open or close it. What a user opened or closed lives here and survives the screen registering again.
 * Choosing an entry (a click, Enter or Space) tells the host which one; the tree does not move the current entry itself: the host registers the page
 * it opened, and that entry becomes current. Kit part it should become: Tree.
 */
export function Tree({ label, nodes, open, current, accent, onChoose }: TreeProps) {
  const [state, setState] = useState<TreeState>(() => ({ open: revealed(nodes, open ?? [], current), stop: undefined }));
  const rows = visibleRows(nodes, state.open);
  const stop = stopOf(rows, state.stop, current);

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
