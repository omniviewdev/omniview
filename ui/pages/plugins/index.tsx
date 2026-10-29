import styles from './PluginsPage.module.css';

// Layout
import Layout from '@/layouts/core/sidenav';

// Components
import PluginsNav from './PluginsNav';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { parseAppError } from '@omniviewdev/runtime';
import { Outlet } from 'react-router';

/**
 * The plugin management page.
 */
const PluginsPage = () => {
  const { plugins } = usePluginManager();

  if (plugins.isLoading) {
    return <div>Loading...</div>;
  }

  if (plugins.isError) {
    return <div>Error: {parseAppError(plugins.error).detail}</div>;
  }

  return (
    <Layout.Root style={{ padding: 0, gap: 0 }}>
      <Layout.SideNav type='transparent' width={340}>
        <div className={styles.NavPane}>
          <PluginsNav />
        </div>
      </Layout.SideNav>
      <Layout.Main>
        <Outlet />
      </Layout.Main>
    </Layout.Root>
  );
};

export default PluginsPage;
