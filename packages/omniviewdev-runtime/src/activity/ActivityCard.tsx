import React from 'react';
import { Button, Card, Code, IconButton, Progress, StatusDot, Text } from '@omniviewdev/base-ui';
import type { ActivityAction, ActivityProgress, ActivityRecord } from './types';
import { useActivityContext } from './context';
import { styles } from './styles';
import { isActiveTask } from './store';

const taskStatuses = {
  starting: 'info',
  running: 'info',
  paused: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  unknown: 'warning',
} as const;

/** Ratios use integer arithmetic; canonical counts never pass through Number. */
export function progressPercent(progress: ActivityProgress): number | undefined {
  if (progress.kind === 'indeterminate') return undefined;
  if (!/^\d+$/.test(progress.current) || !/^\d+$/.test(progress.total)) return undefined;
  const current = BigInt(progress.current),
    total = BigInt(progress.total);
  return total > 0n
    ? Number(((current > total ? total : current) * 10000n) / total) / 100
    : undefined;
}
function progressLabel(progress: ActivityProgress) {
  if (progress.kind === 'indeterminate') return progress.message;
  return progress.kind === 'units'
    ? `${progress.current}/${progress.total} ${progress.unit}`
    : `${progress.current}/${progress.total} ${progress.label}`;
}

export function ActivityCard({
  record,
  toast = false,
}: {
  record: ActivityRecord;
  toast?: boolean;
}) {
  const {
    store,
    setCollapsed,
    dismissToast,
    performAction,
    canHandleAction,
    busyActions,
    actionErrors,
    openDetails,
    selectedDetailsID,
  } = useActivityContext();
  const [detailsState, setDetailsState] = React.useState({
    selection: selectedDetailsID,
    open: selectedDetailsID === record.id,
  });
  const detailsOpen =
    detailsState.selection === selectedDetailsID
      ? detailsState.open
      : selectedDetailsID === record.id;
  const [copyStatus, setCopyStatus] = React.useState('');
  const [presentationError, setPresentationError] = React.useState('');
  const { presentation, visibility } = record;
  const canAnimateProgress = record.task
    ? record.task.state === 'starting' || record.task.state === 'running'
    : record.alert
      ? record.alert.state === 'firing'
      : true;
  const state = record.task?.state ?? record.alert?.state ?? record.severity;
  const status = record.task
    ? taskStatuses[record.task.state]
    : record.alert?.state === 'resolved'
      ? 'success'
      : record.alert?.state === 'unknown'
        ? 'warning'
        : record.severity === 'error'
          ? 'danger'
          : record.severity;
  const hasDetails = !!(
    presentation.details ||
    presentation.message ||
    presentation.metrics?.length ||
    record.source.connectionID ||
    record.alert
  );
  const needsAttention = state === 'failed' || state === 'unknown' || state === 'paused';
  const detailID = React.useId();
  const localActions = store.getDiagnosticActions(record.id);
  const actions: ActivityAction[] = [...(presentation.actions ?? [])];
  if (
    isActiveTask(record) &&
    record.task?.cancellation === 'available' &&
    !actions.some((action) => action.kind === 'cancel-task')
  ) {
    actions.push({
      id: 'cancel-task',
      kind: 'cancel-task',
      label: 'Cancel',
      taskId: record.id,
    });
  }
  const visibleActions = actions.filter((action) => canHandleAction(action, record));
  const persist = (operation: Promise<void>) => {
    setPresentationError('');
    void operation.catch(() =>
      setPresentationError('Could not save notification presentation. Try again.'),
    );
  };
  const progress = presentation.progress &&
    (presentation.progress.kind !== 'indeterminate' || canAnimateProgress) && (
      <div style={visibility.collapsed ? styles.compactProgress : styles.progressRow}>
        <Progress
          size="sm"
          color={status === 'info' ? 'brand' : status}
          aria-label={presentation.title}
          aria-valuetext={progressLabel(presentation.progress)}
          title={presentation.message}
          style={styles.progress}
          value={progressPercent(presentation.progress)}
        />
        {presentation.progress.kind !== 'indeterminate' && (
          <Text
            size="xs"
            tone="muted"
            style={styles.progressCount}
            title={`${progressPercent(presentation.progress) ?? 0}%`}
          >
            {progressLabel(presentation.progress)}
          </Text>
        )}
      </div>
    );
  const body = (
    <article
      style={styles.row}
      aria-label={presentation.title}
      data-activity-surface={toast ? 'toast' : 'center'}
    >
      <div style={styles.title}>
        <StatusDot
          size="sm"
          status={status}
          role="img"
          aria-label={state}
          title={[state, record.task?.unknownReason ?? presentation.message]
            .filter(Boolean)
            .join('\n')}
        />
        <Text size="sm" weight="semibold" style={styles.titleText} title={presentation.title}>
          {presentation.title}
        </Text>
        {needsAttention && (
          <Text size="xs" tone="muted">
            {state}
          </Text>
        )}
        {record.task?.cancellation === 'requested' && (
          <Text size="xs" tone="muted">
            Cancel requested
          </Text>
        )}
        {visibility.collapsed && progress}
        {!visibility.collapsed && hasDetails && (
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Details"
            title="Activity details"
            aria-expanded={toast ? undefined : detailsOpen}
            aria-controls={toast ? undefined : detailID}
            onClick={() => {
              if (toast) {
                openDetails(record.id);
                return;
              }
              setDetailsState({ selection: selectedDetailsID, open: !detailsOpen });
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6M12 7v1" />
            </svg>
          </IconButton>
        )}
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={visibility.collapsed ? 'Expand activity' : 'Collapse activity'}
          aria-expanded={!visibility.collapsed}
          onClick={() => persist(setCollapsed(record.id, !visibility.collapsed))}
        >
          <span aria-hidden="true">{visibility.collapsed ? '⌄' : '⌃'}</span>
        </IconButton>
        {toast && (
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Hide activity toast"
            onClick={() => persist(dismissToast(record.id))}
          >
            <span aria-hidden="true">×</span>
          </IconButton>
        )}
      </div>
      {!visibility.collapsed && progress}
      {!visibility.collapsed && (
        <>
          {(!record.task || needsAttention) && presentation.message && (
            <Text size="sm">{presentation.message}</Text>
          )}
          {(visibleActions.length > 0 || localActions.length > 0) && (
            <div style={styles.actions}>
              {visibleActions.map((action) => {
                const key = `${record.id}:${action.id}`;
                return (
                  <React.Fragment key={action.id}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyActions.has(key)}
                      onClick={() => {
                        void performAction(record, action);
                      }}
                    >
                      {busyActions.has(key) ? `${action.label}…` : action.label}
                    </Button>
                    {actionErrors.get(key) && (
                      <Text size="xs" role="alert" style={styles.error}>
                        {actionErrors.get(key)}
                      </Text>
                    )}
                  </React.Fragment>
                );
              })}
              {localActions.map((action, index) => {
                const key = `${record.id}:local:${index}`;
                return (
                  <React.Fragment key={key}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyActions.has(key)}
                      onClick={() => {
                        void performAction(record, index);
                      }}
                    >
                      {busyActions.has(key) ? `${action.label}…` : action.label}
                    </Button>
                    {actionErrors.get(key) && (
                      <Text size="xs" role="alert" style={styles.error}>
                        {actionErrors.get(key)}
                      </Text>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
          {!toast && detailsOpen && hasDetails && (
            <div id={detailID} style={{ display: 'grid', gap: 'var(--ov-space-2)' }}>
              {record.source.connectionID && (
                <Text size="xs" tone="muted">
                  {record.source.connectionID}
                </Text>
              )}
              {record.alert && (
                <Text size="xs" tone="muted">
                  {record.alert.occurrences}{' '}
                  {record.alert.occurrences === 1 ? 'occurrence' : 'occurrences'}
                </Text>
              )}
              {record.task && !needsAttention && presentation.message && (
                <Text size="sm">{presentation.message}</Text>
              )}
              {!!presentation.metrics?.length && (
                <div style={styles.metrics}>
                  {presentation.metrics.map((metric) => (
                    <Text key={metric.id} size="xs" title={metric.label}>
                      {metric.label}: {metric.value}
                      {metric.unit ? ` ${metric.unit}` : ''}
                    </Text>
                  ))}
                </div>
              )}
              <Text size="xs" tone="muted">
                <time dateTime={record.createdAt}>
                  {new Date(record.createdAt).toLocaleString()}
                </time>
              </Text>
              {presentation.details && (
                <>
                  <Code size="sm" style={styles.code}>
                    {presentation.details}
                  </Code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${presentation.title}\n${record.createdAt}\n${presentation.details}`,
                        );
                        setCopyStatus('Details copied.');
                      } catch {
                        setCopyStatus(
                          'Copy failed. Select the diagnostic text and copy it manually.',
                        );
                      }
                    }}
                  >
                    Copy details
                  </Button>
                  {copyStatus && (
                    <Text size="xs" role="status">
                      {copyStatus}
                    </Text>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
      {presentationError && (
        <Text size="xs" role="alert" style={styles.error}>
          {presentationError}
        </Text>
      )}
    </article>
  );
  return toast ? (
    <Card size="sm" surface="overlay" variant="outline" elevation={3} style={styles.toast}>
      {body}
    </Card>
  ) : (
    body
  );
}
