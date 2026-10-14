import { useLocation, Link } from 'react-router-dom';
import { AppShell } from '@omniviewdev/base-ui';

// Icons
import Icon from '@/components/icons/Icon';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { usePluginService } from '@/features/plugins';

// Project imports
import { IsImage } from '@/utils/url';
import styles from './Sidebar.module.css';

/**
 * The plugin rail on the left edge of the window.
 */
export default function CoreLayoutSidebar() {
  const { pathname } = useLocation();
  const { plugins } = usePluginManager();
  const { registrations } = usePluginService();

  // A plugin that loaded without any pages only contributes to other plugins'
  // extension points, so it has nothing to navigate to. Plugins that have not
  // loaded yet (or failed to) keep their entry.
  const navigable = plugins.data?.filter(({ id }) => registrations.get(id)?.routes.length !== 0);
  const matched = pathname.match(/^\/_plugin\/([A-Za-z0-9-]+).*/)?.[1] || '';

  return (
    <AppShell.Sidebar data-testid='app-sidebar' className={`CoreLayoutSidebar ${styles.Rail}`}>
      <nav aria-label='Sidebar Tabs'>
        {!plugins.isLoading && navigable?.map(({ id, metadata }) => (
          <Link
            key={id}
            to={`/_plugin/${id}`}
            className={styles.Item}
            aria-label={metadata?.name || id}
            aria-current={matched === id ? 'page' : undefined}
          >
            {IsImage(metadata?.icon)
              ? <img src={metadata.icon} alt='' className={styles.Image} />
              : <Icon name={metadata?.icon || ''} size={26} />}
          </Link>
        ))}
      </nav>
    </AppShell.Sidebar>
  );
}
