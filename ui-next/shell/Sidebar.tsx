import { Text } from '@omniviewdev/kit';
import type { ShellSidebar } from './registration';
import styles from './Sidebar.module.css';
import { Tree } from './Tree';

type SidebarProps = { readonly sidebar: ShellSidebar };

/**
 * The sidebar: a navigation landmark named by the registration, the header's title, and the tree. No search field and no header actions
 * yet: ch12 SB1 puts a search above any tree of more than 12 nodes, and the actions have nothing to act on. Kit part it should become: ToolHeader.
 */
export function Sidebar({ sidebar }: SidebarProps) {
  return (
    <nav className={styles.sidebar} data-shell-region="sidebar" aria-label={sidebar.label}>
      <div className={styles.header} data-shell-part="sidebarHeader">
        <Text as="h2" variant="title">{sidebar.title}</Text>
      </div>
      <Tree label={sidebar.label} nodes={sidebar.nodes} open={sidebar.open} current={sidebar.current} accent={sidebar.accent} />
    </nav>
  );
}
