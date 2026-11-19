import { Icon, Text } from '@omniviewdev/kit';
import type { Platform } from './core/chords';
import { useMaybePanel } from './panel/context';
import { StatusToggle } from './StatusToggle';
import { useTabs } from './tabs/context';
import { useBreadcrumb } from './tabs/hooks';
import styles from './StatusBar.module.css';

/**
 * The status bar: the panel's toggle (ch16 S90; only a window that has a panel draws one) and the path of the tab on screen, root first, as a breadcrumb (S61): the last crumb is the
 * page. The path reads the tab model's breadcrumb, so it follows a tab switch and a page that describes itself again, and it is empty while no tab is on screen. Plain text, because a crumb
 * that navigates needs somewhere to go. The bar is a toolbar once it holds a control, and a region with nothing to focus is not an F6 stop: with the toggle it is one. Kit part it should
 * become: StatusBar, with its items and the path.
 */
export function StatusBar({ platform }: { readonly platform: Platform }) {
  const store = useTabs();
  const crumbs = useBreadcrumb(store)?.crumbs ?? [];
  const panel = useMaybePanel();
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
                <span className={styles.text}>
                  <Text variant="caption" tone={isLast ? 'default' : 'muted'}>{crumb.label}</Text>
                </span>
                {isLast ? null : <Icon name="chevron-right" size={12} />}
              </li>
            );
          })}
        </ol>
      </nav>
    </footer>
  );
}
