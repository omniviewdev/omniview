import { Icon, Text } from '@omniviewdev/kit';
import styles from './StatusBar.module.css';

type StatusBarProps = { readonly path: readonly string[] };

/**
 * The status bar with the page's path, root first, as a breadcrumb: the last crumb is the page. Plain text, because a crumb that navigates
 * needs somewhere to go. The bar is not a toolbar until it holds a control, and a region with nothing to focus is not an F6 stop.
 * Kit part it should become: StatusBar, with its items and the path.
 */
export function StatusBar({ path }: StatusBarProps) {
  return (
    <footer className={styles.statusBar} data-shell-region="statusBar" aria-label="Status bar">
      <nav className={styles.path} aria-label="Current resource">
        <ol className={styles.crumbs}>
          {path.map((crumb, index) => {
            const isLast = index === path.length - 1;
            return (
              <li key={`${index}:${crumb}`} className={styles.crumb} aria-current={isLast ? 'page' : undefined}>
                <span className={styles.text}>
                  <Text variant="caption" tone={isLast ? 'default' : 'muted'}>{crumb}</Text>
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
