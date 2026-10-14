import { Outlet } from 'react-router-dom';
import Layout from '@/layouts/core/main';
import styles from './Container.module.css';

/**
 * The routed page area, with the bottom drawer docked underneath it.
 */
export default function Container() {
  return (
    <div className={`Container ${styles.Container}`}>
      <div className={styles.Page}>
        <Outlet />
      </div>
      <Layout.BottomDrawer />
    </div>
  );
}
