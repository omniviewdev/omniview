import { Text } from '@omniviewdev/kit';
import type { ModifierEvent } from './core/tabs';
import type { ShellSidebar } from './registration';
import styles from './Sidebar.module.css';
import { Tree } from './Tree';

type SidebarProps = {
  /** Absent while the plugin's frame is on its way: the region is there, at its rectangle, with no title and no tree. */
  readonly sidebar: ShellSidebar | undefined;
  /** An entry was chosen: its id, and the click that chose it (its modifiers pick the disposition, ch16 S64). */
  readonly onChoose: ((id: string, event: ModifierEvent | undefined) => void) | undefined;
};

/**
 * The sidebar: a navigation landmark named by the registration, the header's title, and the tree. No search field and no header actions
 * yet: ch12 SB1 puts a search above any tree of more than 12 nodes, and the actions have nothing to act on. While the frame is pending it is the same
 * element, busy and empty, so the entries arrive in it without anything moving. Kit part it should become: ToolHeader.
 */
export function Sidebar({ sidebar, onChoose }: SidebarProps) {
  return (
    <nav className={styles.sidebar} data-shell-region="sidebar" aria-label={sidebar?.label ?? 'Loading navigation'} aria-busy={sidebar === undefined ? 'true' : undefined}>
      <div className={styles.header} data-shell-part="sidebarHeader">
        {sidebar === undefined ? null : <Text as="h2" variant="title">{sidebar.title}</Text>}
      </div>
      {sidebar === undefined ? null : <Tree key={sidebar.label} label={sidebar.label} nodes={sidebar.nodes} open={sidebar.open} current={sidebar.current} accent={sidebar.accent} onChoose={onChoose} />}
    </nav>
  );
}
