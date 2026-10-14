import { AppShell } from '@omniviewdev/base-ui';
import Layout from '@/layouts/core/main';
import AppStatusFooter from '@/components/displays/Footer/AppStatusFooter';
import styles from './CoreLayout.module.css';

/**
 * The core layout for the application: header across the top, the plugin rail
 * on the left, routed content with the bottom drawer, and the status footer.
 */
export default function CoreLayout() {
  return (
    <AppShell
      data-testid='app-shell'
      className={styles.Shell}
      headerHeight={38}
      footerHeight={24}
      sidebarWidth={48}
    >
      <Layout.Header />
      <Layout.Sidebar />
      <AppShell.Content data-testid='app-main-content' className={`MainContent ${styles.Main}`}>
        <Layout.Container />
      </AppShell.Content>
      <AppShell.Footer>
        <AppStatusFooter />
      </AppShell.Footer>
    </AppShell>
  );
}
