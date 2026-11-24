import { EmptyState, type EmptyStateProps } from '@omniviewdev/kit';
import styles from './Panel.module.css';

/** The panel keeps its scroll container and polite status around the shared presentation. */
export function PanelEmpty(props: Omit<EmptyStateProps, 'compact'>) {
  return (
    <div className={styles.empty} data-shell-part="panelEmpty" role="status">
      <EmptyState {...props} compact />
    </div>
  );
}
