import { Icon, Text } from '@omniviewdev/kit';
import { useTabs } from './tabs/context';
import { useBreadcrumb } from './tabs/hooks';
import styles from './StatusBar.module.css';

/**
 * The status bar with the path of the tab on screen, root first, as a breadcrumb (ch16 S61): the last crumb is the page. It reads the tab model's breadcrumb, so it follows a tab switch
 * and a page that describes itself again, and it is empty while no tab is on screen. Plain text, because a crumb that navigates needs somewhere to go. The bar is not a toolbar until it
 * holds a control, and a region with nothing to focus is not an F6 stop. Kit part it should become: StatusBar, with its items and the path.
 */
export function StatusBar() {
  const store = useTabs();
  const crumbs = useBreadcrumb(store)?.crumbs ?? [];
  return (
    <footer className={styles.statusBar} data-shell-region="statusBar" aria-label="Status bar">
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
