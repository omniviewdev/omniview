import type { MouseEvent } from 'react';
import { AppShell } from '@omniviewdev/base-ui';

// Icons
import Icon from '@/components/icons/Icon';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { usePluginService } from '@/features/plugins';
import { useActivePageNavigation } from '@/features/workspace/activePageNavigation';

// Project imports
import { IsImage } from '@/utils/url';
import { orFallback } from '@/utils/orFallback';
import styles from './Sidebar.module.css';

const MIDDLE_BUTTON = 1;

/**
 * The plugin rail on the left edge of the window. A click opens the plugin in
 * the active page tab; Ctrl/Cmd+click and middle-click open it in a new tab.
 */
export default function CoreLayoutSidebar() {
  const { pathname, navigate, openInNewTab } = useActivePageNavigation();
  const { plugins } = usePluginManager();
  const { registrations } = usePluginService();

  // A plugin that loaded without any pages only contributes to other plugins'
  // extension points, so it has nothing to navigate to. Plugins that have not
  // loaded yet (or failed to) keep their entry.
  const navigable = plugins.data?.filter(({ id }) => registrations.get(id)?.routes.length !== 0);
  const matched = (/^\/_plugin\/([A-Za-z0-9-]+).*/.exec(pathname))?.[1] ?? '';

  const open = (event: MouseEvent, path: string) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.button === MIDDLE_BUTTON) {
      openInNewTab(path, { background: true });
    } else {
      navigate(path);
    }
  };

  return (
    <AppShell.Sidebar data-testid='app-sidebar' className={`CoreLayoutSidebar ${styles.Rail}`}>
      <nav aria-label='Sidebar Tabs'>
        {!plugins.isLoading && navigable?.map(({ id, metadata }) => (
          <a
            key={id}
            href={`#/_plugin/${id}`}
            className={styles.Item}
            aria-label={orFallback(metadata?.name, id)}
            aria-current={matched === id ? 'page' : undefined}
            onClick={(event) => {
              open(event, `/_plugin/${id}`); 
            }}
            onAuxClick={(event) => {
              if (event.button === MIDDLE_BUTTON) {
                open(event, `/_plugin/${id}`);
              }
            }}
          >
            {IsImage(metadata?.icon)
              ? <img src={metadata.icon} alt='' className={styles.Image} />
              : <Icon name={orFallback(metadata?.icon, '')} size={26} />}
          </a>
        ))}
      </nav>
    </AppShell.Sidebar>
  );
}
