import React from 'react';

import { Button, Dialog, IconButton, Progress, Spinner, Text } from '@omniviewdev/base-ui';

import { LuCircleCheck, LuCircleAlert, LuCircleSlash, LuX } from 'react-icons/lu';
import type { Count, SourceSessionState } from '@omniviewdev/runtime';

import type { ResourceStateItem } from './types';
import styles from './ConnectionStateDialog.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ConnectionStateDialogProps = {
  open: boolean;
  onClose: () => void;
  connectionName: string;
  /** Per-resource source states */
  resources: Record<string, SourceSessionState>;
  /** Per-resource cached object counts */
  resourceCounts: Record<string, Count>;
  /** Called when user clicks Retry on an errored resource */
  onRetryResource: (resourceKey: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whether a state is terminal (done — won't change further) */
const isTerminal = (s: SourceSessionState) =>
  s === 'following' || s === 'finished' || s === 'failed' || s === 'closed';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StateIcon({ state }: { state: SourceSessionState }) {
  switch (state) {
    case 'opening':
    case 'snapshotting':
    case 'resetRequired':
      return <Spinner size="xs" color="brand" />;
    case 'following':
    case 'finished':
      return <LuCircleCheck size={14} className={styles.IconSuccess} />;
    case 'failed':
      return <LuCircleAlert size={14} className={styles.IconDanger} />;
    case 'closed':
      return <LuCircleSlash size={14} className={styles.IconMuted} />;
  }

  return <LuCircleSlash size={14} className={styles.IconMuted} />;
}

/** Per-group progress summary */
function GroupProgress({ items }: { items: ResourceStateItem[] }) {
  const total = items.length;
  const done = items.filter(i => isTerminal(i.state)).length;
  const allDone = total > 0 && done === total;
  const hasError = items.some(i => i.state === 'failed');
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className={styles.GroupProgress}>
      <Progress
        value={percent}
        size="sm"
        color={hasError ? 'danger' : allDone ? 'success' : 'brand'}
        className={styles.GroupProgressBar}
      />
      <Text size="xs" tone="subtle" mono className={styles.GroupProgressLabel}>
        {`${done}/${total}`}
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ConnectionStateDialog({
  open,
  onClose,
  connectionName,
  resources,
  resourceCounts,
  onRetryResource,
}: ConnectionStateDialogProps) {
  const { trackedTotal, trackedDone } = React.useMemo(() => {
    const states = Object.values(resources);
    return { trackedTotal: states.length, trackedDone: states.filter(isTerminal).length };
  }, [resources]);

  const grouped = React.useMemo<Array<[string, ResourceStateItem[]]>>(() => [
    ['Resources', Object.entries(resources).map(([key, state]) => ({
      key,
      kind: key,
      state,
      count: resourceCounts[key],
    }))],
  ], [resources, resourceCounts]);

  const trackedAllDone = trackedTotal > 0 && trackedDone === trackedTotal;
  const percent = trackedTotal > 0 ? Math.round((trackedDone / trackedTotal) * 100) : 0;

  return (
    <Dialog open={open} onClose={onClose} size="md" className={styles.Surface}>
      {/* Header */}
      <div className={styles.Header}>
        <Dialog.Title className={styles.HeaderTitle}>
          {!trackedAllDone && <Spinner size="sm" color="brand" />}
          {trackedAllDone && <LuCircleCheck size={16} className={styles.IconSuccess} />}
          {trackedAllDone ? `Synced "${connectionName}"` : `Syncing "${connectionName}"`}
        </Dialog.Title>
        <IconButton size="sm" variant="ghost" color="neutral" aria-label="Close" onClick={onClose}>
          <LuX size={16} />
        </IconButton>
      </div>

      {/* Progress bar */}
      <div className={styles.ProgressSection}>
        <div className={styles.ProgressRow}>
          <Progress
            value={percent}
            size="lg"
            color={trackedAllDone ? 'success' : 'brand'}
            className={styles.ProgressBar}
          />
          <Text size="xs" tone="muted" className={styles.ProgressLabel}>
            {percent}%&ensp;{trackedDone}/{trackedTotal}
          </Text>
        </div>
      </div>

      {/* Resource list */}
      <div className={styles.Content}>
        {grouped.map(([groupLabel, items]) => (
          <div key={groupLabel}>
            {/* Group header with progress */}
            <div className={styles.GroupHeader}>
              <Text size="xs" weight="semibold" tone="muted" className={styles.GroupLabel}>
                {groupLabel}
              </Text>
              <GroupProgress items={items} />
            </div>
            {items.sort((a, b) => a.kind.localeCompare(b.kind)).map(({ key, kind, state, count }) => (
              <div
                key={key}
                className={styles.Row}
                data-dimmed={state === 'closed' ? 'true' : undefined}
              >
                <StateIcon state={state} />
                <Text size="xs" className={styles.Kind}>{kind}</Text>
                {state === 'closed' && (
                  <Text size="xs" tone="subtle" className={styles.Note}>
                    Closed
                  </Text>
                )}
                {(state === 'following' || state === 'finished') && count && (
                  <Text size="xs" tone="subtle" mono>
                    {count.value === undefined ? count.kind : `${count.value} (${count.kind})`}
                  </Text>
                )}
                {state === 'failed' && (
                  <Button
                    variant="soft"
                    size="xs"
                    color="danger"
                    onClick={() => {
                      onRetryResource(key); 
                    }}
                    className={styles.RetryButton}
                  >
                    Retry
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className={styles.Footer}>
        <Button variant="soft" size="sm" color="neutral" onClick={onClose}>
          Dismiss
        </Button>
      </div>
    </Dialog>
  );
}
