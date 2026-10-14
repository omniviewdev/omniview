import React from 'react';
import { Button, Text } from '@omniviewdev/base-ui';
import styles from './QuarantinedContributionFallback.module.css';

export type QuarantinedContributionFallbackProps = {
  readonly pluginId: string;
  readonly extensionPointId: string;
  readonly contributionId: string;
  readonly crashCount: number;
  readonly onReEnable: () => void;
};

/**
 * Dev-mode inline fallback for quarantined contributions.
 * Shows which contribution was suppressed and offers a re-enable button.
 * Only rendered in dev mode — production uses empty slots + notifications.
 */
export function QuarantinedContributionFallback({
  pluginId,
  extensionPointId,
  contributionId,
  crashCount,
  onReEnable,
}: QuarantinedContributionFallbackProps): React.ReactElement {
  return (
    <div role="alert" className={styles.Root}>
      <Text size="xs" tone="warning" weight="semibold">
        Quarantined Extension
      </Text>
      <Text size="xs" tone="muted" className={styles.Line}>
        Plugin: {pluginId}
      </Text>
      <Text size="xs" tone="muted" className={styles.Line}>
        Extension Point: {extensionPointId}
      </Text>
      <Text size="xs" tone="muted" className={styles.Line}>
        Contribution: {contributionId}
      </Text>
      <Text size="xs" tone="muted" className={styles.Line}>
        Crashes: {crashCount}
      </Text>
      <Button
        size="sm"
        variant="outline"
        color="warning"
        onClick={onReEnable}
        className={styles.Action}
      >
        Re-enable
      </Button>
    </div>
  );
}
