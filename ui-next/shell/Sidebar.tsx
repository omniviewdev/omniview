import { Text } from '@omniviewdev/kit';
import { useCallback } from 'react';
import type { ModifierEvent } from './core/tabs';
import type { TreeMemory } from './core/tree';
import type { ShellSidebar } from './registration';
import styles from './Sidebar.module.css';
import { Tree } from './Tree';

type SidebarProps = {
  /** Absent while the plugin's frame is on its way: the region is there, at its rectangle, with no title and no tree. */
  readonly sidebar: ShellSidebar | undefined;
  /** An entry was chosen: its id, and the click that chose it (its modifiers pick the disposition, ch16 S64). */
  readonly onChoose: ((id: string, event: ModifierEvent | undefined) => void) | undefined;
  /** The rail entry whose sidebar this is. The tree is another tree when it changes: what was opened in one entry's sidebar stays with that entry, even if another's is called the same and has the same ids. */
  readonly owner: string | undefined;
  /** The groups of the tree that are open on screen, and the rail entry whose tree they are: told when the tree mounts, on each change, and as none when it goes away. */
  readonly onOpen: ((owner: string | undefined, open: readonly string[]) => void) | undefined;
  /** What the window remembers of its sidebars' trees: the tree of this entry recalls its groups there when it mounts, so a plugin that stopped and was loaded again shows them as they were left. Absent: the tree forgets with its screen. */
  readonly memory?: TreeMemory | undefined;
};

/**
 * The sidebar: a navigation landmark named by the registration, the header's title, and the tree. No search field and no header actions
 * yet: ch12 SB1 puts a search above any tree of more than 12 nodes, and the actions have nothing to act on. While the frame is pending it is the same
 * element, busy and empty, so the entries arrive in it without anything moving. Kit part it should become: ToolHeader.
 */
export function Sidebar({ sidebar, owner, onChoose, onOpen, memory }: SidebarProps) {
  const report = useCallback(
    (open: readonly string[]) => {
      onOpen?.(owner, open);
    },
    [onOpen, owner],
  );
  // The tree of one entry's sidebar, by the entry and by its name: what a user opened in one is that tree's (the key of the element and of the memory are the same), even when another is called the same and has the same ids.
  const treeKey = `${owner ?? ''}\u0000${sidebar?.label ?? ''}`;
  return (
    <nav className={styles.sidebar} data-shell-region="sidebar" aria-label={sidebar?.label ?? 'Loading navigation'} aria-busy={sidebar === undefined ? 'true' : undefined}>
      <div className={styles.header} data-shell-part="sidebarHeader">
        {sidebar === undefined ? null : <Text as="h2" variant="title">{sidebar.title}</Text>}
      </div>
      {sidebar === undefined ? null : <Tree key={treeKey} label={sidebar.label} nodes={sidebar.nodes} open={sidebar.open} current={sidebar.current} accent={sidebar.accent} memory={memory} memoryKey={treeKey} onChoose={onChoose} onOpenChange={onOpen === undefined ? undefined : report} />}
    </nav>
  );
}
