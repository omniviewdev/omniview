import React from 'react';

import { Button, Dialog, IconButton, Progress, Spinner, Text } from '@omniviewdev/base-ui';

import { LuCircleCheck, LuCircleAlert, LuCircleSlash, LuShieldAlert, LuX } from 'react-icons/lu';
import { WatchState, parseResourceKey, formatGroup } from '@omniviewdev/runtime';

import type { ResourceStateItem } from './types';
import styles from './ConnectionStateDialog.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ConnectionStateDialogProps = {
  open: boolean;
  onClose: () => void;
  connectionName: string;
  /** Per-resource watch states from useWatchState */
  resources: Record<string, WatchState>;
  /** Per-resource cached object counts */
  resourceCounts: Record<string, number>;
  /** Called when user clicks Retry on an errored resource */
  onRetryResource: (resourceKey: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whether a state is terminal (done — won't change further) */
const isTerminal = (s: WatchState) =>
  s === WatchState.WatchStateSynced ||
  s === WatchState.WatchStateError ||
  s === WatchState.WatchStateStopped ||
  s === WatchState.WatchStateFailed ||
  s === WatchState.WatchStateForbidden ||
  s === WatchState.WatchStateSkipped;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StateIcon({ state }: { state: WatchState }) {
  switch (state) {
    case WatchState.WatchStateIdle:
      return <LuCircleSlash size={14} className={styles.IconMuted} />;
    case WatchState.WatchStateSyncing:
      return <Spinner size="xs" color="brand" />;
    case WatchState.WatchStateSynced:
      return <LuCircleCheck size={14} className={styles.IconSuccess} />;
    case WatchState.WatchStateError:
      return <LuCircleAlert size={14} className={styles.IconDanger} />;
    case WatchState.WatchStateFailed:
      return <LuCircleAlert size={14} className={styles.IconDanger} />;
    case WatchState.WatchStateForbidden:
      return <LuShieldAlert size={14} className={styles.IconWarning} />;
    case WatchState.WatchStateStopped:
      return <LuCircleSlash size={14} className={styles.IconMuted} />;
    case WatchState.WatchStateSkipped:
      return <LuCircleSlash size={14} className={styles.IconMuted} />;
  }

  return <LuCircleSlash size={14} className={styles.IconMuted} />;
}

/** Per-group progress summary — excludes SKIPPED from totals */
function GroupProgress({ items }: { items: ResourceStateItem[] }) {
  const watched = items.filter(i => i.state !== WatchState.WatchStateSkipped);
  const skipped = items.length - watched.length;
  const total = watched.length;
  const done = watched.filter(i => isTerminal(i.state)).length;
  const allDone = total > 0 && done === total;
  const allSkipped = total === 0 && skipped > 0;
  const hasError = watched.some(i => i.state === WatchState.WatchStateError);
  const percent = total > 0 ? Math.round((done / total) * 100) : allSkipped ? 100 : 0;

  return (
    <div className={styles.GroupProgress}>
      <Progress
        value={percent}
        size="sm"
        color={hasError ? 'danger' : (allDone || allSkipped) ? 'success' : 'brand'}
        className={styles.GroupProgressBar}
      />
      <Text size="xs" tone="subtle" mono className={styles.GroupProgressLabel}>
        {allSkipped ? `${skipped} skipped` : `${done}/${total}`}
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
  // Count resources by category: watched (attempted) vs skipped/inaccessible
  const { watchedTotal, watchedDone, skippedCount } = React.useMemo(() => {
    let watched = 0;
    let done = 0;
    let skipped = 0;
    for (const state of Object.values(resources)) {
      if (state === WatchState.WatchStateSkipped) {
        skipped++;
        continue;
      }

      watched++;
      if (isTerminal(state)) {
        done++;
      }
    }

    return { watchedTotal: watched, watchedDone: done, skippedCount: skipped };
  }, [resources]);

  // Group resources by API group
  const grouped = React.useMemo(() => {
    const groups: Record<string, ResourceStateItem[]> = {};

    for (const [key, state] of Object.entries(resources)) {
      const { group, kind } = parseResourceKey(key);
      const label = formatGroup(group);
      if (!groups[label]) {
        groups[label] = [];
      }

      groups[label].push({ key, kind, state, count: resourceCounts[key] ?? 0 });
    }

    // Sort groups alphabetically, but put "Core" first
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Core') {
        return -1;
      }

      if (b === 'Core') {
        return 1;
      }

      return a.localeCompare(b);
    });
  }, [resources, resourceCounts]);

  // Progress based on watched resources only (SKIPPED excluded from denominator)
  const watchedAllDone = watchedTotal > 0 && watchedDone === watchedTotal;
  const percent = watchedTotal > 0 ? Math.round((watchedDone / watchedTotal) * 100) : 0;

  return (
    <Dialog open={open} onClose={onClose} size="md" className={styles.Surface}>
      {/* Header */}
      <div className={styles.Header}>
        <Dialog.Title className={styles.HeaderTitle}>
          {!watchedAllDone && <Spinner size="sm" color="brand" />}
          {watchedAllDone && <LuCircleCheck size={16} className={styles.IconSuccess} />}
          {watchedAllDone ? `Synced "${connectionName}"` : `Syncing "${connectionName}"`}
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
            color={watchedAllDone ? 'success' : 'brand'}
            className={styles.ProgressBar}
          />
          <Text size="xs" tone="muted" className={styles.ProgressLabel}>
            {percent}%&ensp;{watchedDone}/{watchedTotal}
          </Text>
        </div>
        {skippedCount > 0 && (
          <Text size="xs" tone="subtle" className={styles.SkippedNote}>
            {skippedCount} resource{skippedCount !== 1 ? 's' : ''} skipped (unavailable on this cluster)
          </Text>
        )}
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
                data-dimmed={(state === WatchState.WatchStateStopped || state === WatchState.WatchStateSkipped || state === WatchState.WatchStateIdle) ? 'true' : undefined}
              >
                <StateIcon state={state} />
                <Text size="xs" className={styles.Kind}>{kind}</Text>
                {state === WatchState.WatchStateForbidden && (
                  <Text size="xs" tone="warning" className={styles.Note}>
                    No access
                  </Text>
                )}
                {state === WatchState.WatchStateSkipped && (
                  <Text size="xs" tone="subtle" className={styles.Note}>
                    Skipped
                  </Text>
                )}
                {state === WatchState.WatchStateStopped && (
                  <Text size="xs" tone="subtle" className={styles.Note}>
                    Stopped
                  </Text>
                )}
                {state === WatchState.WatchStateSynced && count > 0 && (
                  <Text size="xs" tone="subtle" mono>
                    {count}
                  </Text>
                )}
                {(state === WatchState.WatchStateError || state === WatchState.WatchStateFailed) && (
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
