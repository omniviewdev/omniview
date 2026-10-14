import React from 'react';
import { Progress, StatusBar } from '@omniviewdev/base-ui';
import {
  LuPlug,
  LuRefreshCw,
  LuUnplug,
  LuInfo,
} from 'react-icons/lu';
import {
  useConnectionStatus,
  type ConnectionStatusEntry,
} from '@omniviewdev/runtime';

import { Dot, FooterPopover, FooterTrigger, PopoverAction, PopoverHeader, cx, footerStyles as styles } from './parts';

// ---------------------------------------------------------------------------
// PluginGroupHeader — uppercase group label per plugin
// ---------------------------------------------------------------------------

function PluginGroupHeader({ pluginID }: { pluginID: string }) {
  return <div className={styles.GroupHeader}>{pluginID}</div>;
}

// ---------------------------------------------------------------------------
// ConnectionRow — per-connection status, progress, and actions
// ---------------------------------------------------------------------------

function ConnectionRow({
  entry,
  onDisconnect,
  onRetry,
  onRetryPlugin,
}: {
  entry: ConnectionStatusEntry;
  onDisconnect: (pluginID: string, connectionID: string) => void;
  onRetry: (pluginID: string, connectionID: string) => void;
  onRetryPlugin: (pluginID: string) => void;
}) {
  const { pluginID, connectionID, name, sync, isSyncing, hasErrors, pluginFailed } = entry;

  const status = pluginFailed || hasErrors ? 'danger' : isSyncing ? 'info' : 'success';

  let statusText = 'Connected';
  if (pluginFailed) {
    statusText = 'Plugin crashed — recovery failed';
  } else if (isSyncing && sync) {
    statusText = `Syncing ${sync.doneCount}/${sync.watchedTotal} resources`;
  } else if (hasErrors && sync) {
    statusText = `${sync.errorCount} error${sync.errorCount !== 1 ? 's' : ''}`;
  } else if (sync && sync.watchedTotal > 0) {
    statusText = `Connected · ${sync.watchedTotal} resources`;
  }

  const percent = sync ? Math.round(sync.progress * 100) : 0;

  const handleDetails = () => {
    window.dispatchEvent(
      new CustomEvent('ov:show-connection-state', {
        detail: { pluginID, connectionID, connectionName: name },
      }),
    );
  };

  return (
    <div className={styles.ListItem}>
      {/* Name + status dot */}
      <div className={styles.Group}>
        <Dot status={status} pulse={isSyncing} />
        <span className={cx(styles.Title, styles.Truncate)}>{name}</span>
      </div>

      {/* Status text */}
      <div className={cx(styles.Detail, styles.Indent)}>{statusText}</div>

      {/* Progress bar when syncing */}
      {isSyncing && (
        <div className={styles.Indent}>
          <Progress size='xs' color='info' value={percent} aria-label='Sync progress' />
        </div>
      )}

      {/* Actions */}
      <div className={styles.RowActions}>
        {sync && !pluginFailed && (
          <PopoverAction icon={<LuInfo size={11} />} label='Details' onClick={handleDetails} />
        )}
        {pluginFailed && (
          <PopoverAction
            icon={<LuRefreshCw size={11} />}
            label='Retry Plugin'
            onClick={() => onRetryPlugin(pluginID)}
            tone='info'
          />
        )}
        {hasErrors && !pluginFailed && (
          <PopoverAction
            icon={<LuRefreshCw size={11} />}
            label='Retry'
            onClick={() => onRetry(pluginID, connectionID)}
          />
        )}
        <PopoverAction
          icon={<LuUnplug size={11} />}
          label='Disconnect'
          onClick={() => onDisconnect(pluginID, connectionID)}
          tone='danger'
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectionStatusIndicator — footer trigger
// ---------------------------------------------------------------------------

export default function ConnectionStatusIndicator() {
  const {
    grouped,
    connectedCount,
    syncingCount,
    errorCount,
    failedCount,
    hasSyncing,
    aggregateProgress,
    disconnect,
    retryWatch,
    retryPlugin,
  } = useConnectionStatus();

  // Nothing to show
  if (connectedCount === 0) return null;

  let status: 'success' | 'danger' | 'info' = 'success';
  let label = `${connectedCount} connected`;

  if (failedCount > 0) {
    status = 'danger';
    const nonFailedErrors = errorCount - failedCount;
    label = nonFailedErrors > 0
      ? `${failedCount} failed, ${nonFailedErrors} error${nonFailedErrors !== 1 ? 's' : ''}`
      : `${failedCount} failed`;
  } else if (errorCount > 0) {
    status = 'danger';
    label = `${errorCount} error${errorCount !== 1 ? 's' : ''}`;
  } else if (hasSyncing) {
    status = 'info';
    label = `${syncingCount} syncing`;
  }

  const tooltipText = `${connectedCount} connection${connectedCount !== 1 ? 's' : ''} active`;

  const onDisconnect = (p: string, c: string) => {
    void disconnect(p, c).catch((err: unknown) => {
      console.error('Disconnect failed:', err);
    });
  };
  const onRetry = (p: string, c: string) => {
    void retryWatch(p, c).catch((err: unknown) => {
      console.error('Retry watch failed:', err);
    });
  };
  const onRetryPlugin = (p: string) => {
    void retryPlugin(p).catch((err: unknown) => {
      console.error('Retry plugin failed:', err);
    });
  };

  return (
    <>
      <StatusBar.Separator />
      <FooterPopover
        tooltip={tooltipText}
        width='wide'
        trigger={
          <FooterTrigger>
            <LuPlug size={10} />
            <span>{label}</span>
            <Dot status={status} pulse={hasSyncing} />
          </FooterTrigger>
        }
      >
        {() => (
          <>
            <PopoverHeader
              icon={<LuPlug size={12} className={styles.MutedIcon} />}
              title={`Active Connections (${connectedCount})`}
            />
            {/* Connection list grouped by plugin */}
            <div className={styles.List} data-size='lg'>
              {Array.from(grouped.entries()).map(([pluginID, pluginEntries]) => (
                <React.Fragment key={pluginID}>
                  <PluginGroupHeader pluginID={pluginID} />
                  {pluginEntries.map((entry) => (
                    <ConnectionRow
                      key={`${entry.pluginID}/${entry.connectionID}`}
                      entry={entry}
                      onDisconnect={onDisconnect}
                      onRetry={onRetry}
                      onRetryPlugin={onRetryPlugin}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          </>
        )}
      </FooterPopover>
      {/* Inline progress bar when syncing */}
      {hasSyncing && (
        <StatusBar.Progress
          className={styles.InlineProgress}
          value={Math.round(aggregateProgress * 100)}
          color='info'
          aria-label='Sync progress'
        />
      )}
    </>
  );
}
