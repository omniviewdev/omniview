import { Icon, Text } from '@omniviewdev/kit';
import type { MouseEvent } from 'react';
import type { Platform } from './core/chords';
import { dispositionOf, type Route } from './core/tabs';
import { Bell } from './notices/Bell';
import { useMaybeNotices } from './notices/context';
import { useMaybePanel } from './panel/context';
import { StatusToggle } from './StatusToggle';
import { useTabs } from './tabs/context';
import { useBreadcrumb } from './tabs/hooks';
import styles from './StatusBar.module.css';

/** A parent provided by the tab's description. Open the route itself, including its parameters, never the displayed label. */
function ParentCrumb({ label, route, platform }: { readonly label: string; readonly route: Route; readonly platform: Platform }) {
  const store = useTabs();
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.defaultPrevented || event.button !== (event.type === 'auxclick' ? 1 : 0)) {
      return;
    }

    event.preventDefault();
    store.open({ route }, { how: dispositionOf(event, { platform }), source: 'crumb' });
  };
  return (
    <button type="button" className={styles.crumbLink} data-shell-focus="" tabIndex={0} onClick={open} onAuxClick={open}>
      {label}
    </button>
  );
}

/**
 * The status bar holds the panel toggle, the active tab's path (S61) and the notification bell. Only parents with a route are controls;
 * label-only ancestors and the current page are text. The tab model owns the path and refreshes it on a tab switch or a new description.
 */
export function StatusBar({ platform }: { readonly platform: Platform }) {
  const store = useTabs();
  const crumbs = useBreadcrumb(store)?.crumbs ?? [];
  const panel = useMaybePanel();
  const centre = useMaybeNotices()?.centre;
  return (
    <footer className={styles.statusBar} data-shell-region="statusBar" aria-label="Status bar">
      {panel === null ? null : (
        <div className={styles.items} role="toolbar" aria-label="Status items" data-shell-part="statusItems">
          <StatusToggle platform={platform} />
        </div>
      )}
      <nav className={styles.path} aria-label="Current resource">
        <ol className={styles.crumbs}>
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <li key={`${String(index)}:${crumb.label}`} className={styles.crumb} aria-current={isLast ? 'page' : undefined}>
                {!isLast && crumb.route !== undefined ? (
                  <ParentCrumb label={crumb.label} route={crumb.route} platform={platform} />
                ) : (
                  <span className={styles.text}>
                    <Text variant="caption" tone={isLast ? 'default' : 'muted'}>{crumb.label}</Text>
                  </span>
                )}
                {isLast ? null : <Icon name="chevron-right" size={12} />}
              </li>
            );
          })}
        </ol>
      </nav>
      {centre === undefined ? null : <Bell centre={centre} />}
    </footer>
  );
}
