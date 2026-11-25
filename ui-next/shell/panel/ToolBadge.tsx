import { Text } from '@omniviewdev/kit';
import type { ToolBadge as Badge } from './badge';
import styles from './ToolBadge.module.css';

/** The words a tab is named by when it carries a badge: the visible text stays whole inside the name (WCAG 2.5.3), so a count is the number's own words after it (`Problems 2 errors`) and a dot is a clause (`Operations, 1 unread failure`). */
export function tabName(label: string, badge: Badge | undefined): string {
  if (badge === undefined) {
    return label;
  }

  return badge.kind === 'count' ? `${label} ${badge.label}` : `${label}, ${badge.label}`;
}

/** What a tool tab draws for its badge: a count after the label, or a dot on its corner. The tab's name carries the words (`tabName`), so neither is read twice. */
export function ToolBadgeMark({ badge }: { readonly badge: Badge }) {
  if (badge.kind === 'count') {
    return (
      <span className={styles.count} data-shell-part="toolBadge" data-kind="count" aria-hidden="true">
        <Text>{` ${String(badge.count)}`}</Text>
      </span>
    );
  }

  return <span className={styles.dot} data-shell-part="toolBadge" data-kind="dot" data-tone={badge.tone} aria-hidden="true" />;
}
