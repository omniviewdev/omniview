import Layout from '@/layouts/core/main';
import { WorkspacePanes } from '@/features/workspace';
import styles from './Container.module.css';

/**
 * The page tab panes, with the bottom drawer docked underneath them.
 */
export default function Container() {
  return (
    <div className={`Container ${styles.Container}`}>
      <div className={styles.Page}>
        <WorkspacePanes />
      </div>
      <Layout.BottomDrawer />
    </div>
  );
}
