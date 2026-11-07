import React from 'react';
import { Button, Card, EmptyState, IconButton, Text, Toolbar } from '@omniviewdev/base-ui';
import { useActivityContext } from './context';
import { isActiveTask, needsAttention } from './store';
import { ActivityCard } from './ActivityCard';
import { styles } from './styles';

export function NotificationCenter() {
  const {
    store,
    records,
    centerOpen,
    filter,
    openNotifications,
    closeNotifications,
    clearHistory,
    error,
    restoreFocus,
  } = useActivityContext();
  const panel = React.useRef<HTMLDivElement>(null);
  const [clearError, setClearError] = React.useState('');
  const [copyStatus, setCopyStatus] = React.useState('');
  React.useEffect(() => {
    if (!centerOpen) return;
    const previousFocus = document.activeElement;
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        !(event.target instanceof Node) ||
        !panel.current?.contains(event.target)
      )
        return;
      if (
        document.querySelector(
          '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
        )
      )
        return;
      event.stopPropagation();
      closeNotifications();
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      else restoreFocus?.();
    };
  }, [centerOpen, closeNotifications, restoreFocus]);
  if (!centerOpen) return null;
  const { pinnedIds } = store.getSnapshot();
  const visible = records.filter(
    (record) =>
      pinnedIds.has(record.id) ||
      filter === 'all' ||
      (filter === 'active' ? isActiveTask(record) : needsAttention(record)),
  );
  return (
    <Card
      ref={panel}
      data-activity-surface="center"
      style={styles.panel}
      size="sm"
      variant="outline"
      surface="overlay"
      elevation={3}
      role="region"
      aria-label="Notifications"
      tabIndex={-1}
    >
      <Toolbar size="sm" style={styles.header}>
        <Text size="sm" weight="semibold">
          Notifications
        </Text>
        <Text size="xs" tone="muted">
          {records.length}
        </Text>
        <Toolbar.Group style={{ marginLeft: 'auto' }}>
          <Button
            size="sm"
            variant="ghost"
            disabled={!records.length}
            onClick={() => {
              setClearError('');
              void clearHistory().catch(() => setClearError('Could not clear history. Try again.'));
            }}
          >
            Clear history
          </Button>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Close notifications"
            onClick={closeNotifications}
          >
            <span aria-hidden="true">×</span>
          </IconButton>
        </Toolbar.Group>
      </Toolbar>
      <div style={{ ...styles.actions, padding: 'var(--ov-space-2) var(--ov-space-3)' }}>
        {(['all', 'active', 'attention'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={value === filter ? 'outline' : 'ghost'}
            aria-pressed={filter === value}
            onClick={() => openNotifications(value)}
          >
            {value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Attention'}
          </Button>
        ))}
      </div>
      {(error || clearError) && (
        <div style={{ padding: 'var(--ov-space-3)' }}>
          <Text size="sm" role="alert" style={styles.error}>
            {clearError || error}
          </Text>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(clearError || error || '');
                setCopyStatus('Diagnostic copied.');
              } catch {
                setCopyStatus('Copy failed. Select the diagnostic text and copy it manually.');
              }
            }}
          >
            Copy diagnostic
          </Button>
          {copyStatus && (
            <Text size="xs" role="status">
              {copyStatus}
            </Text>
          )}
        </div>
      )}
      <div style={styles.list}>
        {!visible.length && (
          <EmptyState
            size="sm"
            title="No activities"
            description="Tasks and notifications appear here."
          />
        )}
        {visible.map((record) => (
          <ActivityCard key={record.id} record={record} />
        ))}
      </div>
    </Card>
  );
}
