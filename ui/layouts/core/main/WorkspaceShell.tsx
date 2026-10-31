import { AppShell } from '@omniviewdev/base-ui';
import Layout from '@/layouts/core/main';
import AppStatusFooter from '@/components/displays/Footer/AppStatusFooter';
import { WorkspaceProvider } from '@/features/workspace';
import { currentWindow } from '@/features/windows';
import styles from './WorkspaceShell.module.css';

/**
 * The frame of a workspace window: header across the top (with the new-tab
 * launcher), the page tab panes with the bottom drawer, and the status footer.
 * Pages render inside per-tab routers; the frame itself is outside every router.
 */
export default function WorkspaceShell() {
  return (
    <WorkspaceProvider>
      <AppShell
        data-testid='app-shell'
        data-ov-window-name={currentWindow.name}
        data-ov-window-kind={currentWindow.kind}
        className={styles.Shell}
        headerHeight={38}
        footerHeight={24}
        // No sidebar: AppShell otherwise reserves a 240px column for one.
        sidebarWidth={0}
      >
        <Layout.Header />
        <AppShell.Content data-testid='app-main-content' className={`MainContent ${styles.Main}`}>
          <Layout.Container />
        </AppShell.Content>
        <AppShell.Footer>
          <AppStatusFooter />
        </AppShell.Footer>
      </AppShell>
    </WorkspaceProvider>
  );
}
