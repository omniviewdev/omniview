import { Button, Icon, Text, type IconName } from '@omniviewdev/kit';
import styles from './Panel.module.css';

type EmptyStateProps = {
  readonly icon: IconName;
  readonly title: string;
  readonly hint: string;
  /** The one action that leads out of the empty state, when there is one: a button with a label and what it does. */
  readonly action?: { readonly label: string; readonly onSelect: () => void } | undefined;
};

/**
 * What the panel shows where a body would be and there is none (ch16 A2, S116): a glyph, what is missing, one line of how to get it, and the one action that does, when the owner of the tool
 * has one. A hidden panel is 0 px, never an empty strip, so this is drawn only in an open panel. It names no tool: the host has none to name, and what it says holds for every tool. The region
 * is the size container and the stack inside it is what a short panel restyles (Panel.module.css).
 */
export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className={styles.empty} data-shell-part="panelEmpty" role="status">
      <div className={styles.emptyStack}>
        <Icon name={icon} />
        <Text as="p" variant="title">
          {title}
        </Text>
        <Text as="p" tone="muted">
          {hint}
        </Text>
        {action === undefined ? null : (
          <Button icon="plus" onClick={action.onSelect}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
