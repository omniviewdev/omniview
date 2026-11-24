import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import styles from './EmptyState.module.css';

export type EmptyStateProps = {
  readonly icon: IconName;
  /** Say what is missing. */
  readonly title: string;
  /** Say what appears here and how it gets here. */
  readonly hint: string;
  /** Use a bare glyph and body text instead of the standard icon box and caption. */
  readonly compact?: boolean | undefined;
  /** The one action that leads out of the state, if there is one. */
  readonly action?: { readonly label: string; readonly icon?: IconName | undefined; readonly onSelect: () => void } | undefined;
} & DataAttributes;

/** Explains an empty surface. The host owns placement, announcements, and focus. Only `data-*` attributes pass through. */
export function EmptyState({ icon, title, hint, compact = false, action, ...rest }: EmptyStateProps) {
  return (
    <div {...dataAttributes(rest)} className={styles.root} data-ov-part="empty-state" data-ov-compact={compact ? '' : undefined}>
      <span className={styles.icon} data-ov-part="icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <Text as="p" variant="title" data-ov-part="title">
        {title}
      </Text>
      <Text as="p" variant={compact ? 'body' : 'caption'} tone="muted" data-ov-part="hint">
        {hint}
      </Text>
      {action === undefined ? null : (
        <Button
          icon={action.icon}
          onClick={() => {
            action.onSelect();
          }}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
