import React from 'react';
import { Spinner, StatusBar } from '@omniviewdev/base-ui';
import {
  LuPlug,
  LuBell,
  LuHammer,
  LuSquare,
  LuPlay,
  LuRefreshCw,
  LuTriangleAlert,
  LuNetwork,
  LuExternalLink,
  LuX,
} from 'react-icons/lu';
import { Events } from '@omniviewdev/runtime/runtime';
import type { PluginMeta } from '@omniviewdev/runtime/models';

import { useDevServers } from '@/features/devtools/useDevServers';
import { devToolsChannel } from '@/features/devtools/events';
import type { DevServerAggregateStatus, DevServerState } from '@/features/devtools/types';
import { getAggregateStatus } from '@/features/devtools/types';
import { useDevServer } from '@/hooks/plugin/useDevServer';
import { usePluginService } from '@/features/plugins';
import { usePortForwardSessions, useOperations } from '@omniviewdev/runtime';
import type { Operation } from '@omniviewdev/runtime';
import HintTooltip from '@/components/base/HintTooltip';

import ConnectionStatusIndicator from './ConnectionStatusIndicator';
import {
  Dot,
  FooterChip,
  FooterLabel,
  FooterPopover,
  FooterTrigger,
  PopoverAction,
  PopoverHeader,
  cx,
  footerStyles as styles,
  type FooterTone,
} from './parts';

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<DevServerAggregateStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  ready: 'success',
  building: 'warning',
  error: 'danger',
  stopped: 'neutral',
  connecting: 'info',
};

const STATUS_LABELS: Record<DevServerAggregateStatus, string> = {
  ready: 'Ready',
  building: 'Building...',
  error: 'Error',
  stopped: 'Stopped',
  connecting: 'Connecting...',
};

// ---------------------------------------------------------------------------
// DevModeChip — only visible in dev builds
// ---------------------------------------------------------------------------

function DevModeChip() {
  if (!import.meta.env.DEV) return null;
  return (
    <HintTooltip content='Running in development mode' side='top'>
      <span className={styles.Chip} data-tone='warning' tabIndex={-1}>DEVELOPMENT MODE</span>
    </HintTooltip>
  );
}

// ---------------------------------------------------------------------------
// DevServerPopover — details and actions for one dev server
// ---------------------------------------------------------------------------

function DevServerPopoverBody({ pluginId, state, onClose }: { pluginId: string; state: DevServerState; onClose: () => void }) {
  const { start, stop, restart } = useDevServer(pluginId);
  const aggStatus = getAggregateStatus(state);
  const isRunning = aggStatus === 'ready' || aggStatus === 'building' || aggStatus === 'connecting' || aggStatus === 'error';

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <>
      {/* Header */}
      <PopoverHeader
        title={
          <>
            {pluginId}
            {state.mode === 'external' && <span className={styles.Badge}>External</span>}
          </>
        }
      >
        <FooterLabel tone={STATUS_TONE[aggStatus]} label={STATUS_LABELS[aggStatus]} />
      </PopoverHeader>

      {/* Details */}
      <div className={styles.Details}>
        {state.devPath && <DetailRow label='Source' value={state.devPath} mono />}
        {state.vitePort > 0 && <DetailRow label='Vite' value={`http://127.0.0.1:${state.vitePort}`} mono />}
        <DetailRow
          label='gRPC'
          value={state.grpcConnected ? 'Connected' : 'Disconnected'}
          tone={state.grpcConnected ? 'success' : 'danger'}
        />
        {state.lastError && <div className={styles.ErrorBox}>{state.lastError}</div>}
      </div>

      {/* Actions */}
      <div className={styles.Actions}>
        <PopoverAction
          icon={<LuHammer size={12} />}
          label='Logs'
          onClick={run(() => devToolsChannel.emit('onOpenBuildOutput', pluginId))}
        />
        {isRunning ? (
          <PopoverAction icon={<LuSquare size={12} />} label='Stop' tone='danger' onClick={run(() => stop.mutate(pluginId))} />
        ) : (
          <PopoverAction icon={<LuPlay size={12} />} label='Start' tone='success' onClick={run(() => start.mutate(pluginId))} />
        )}
        <PopoverAction
          icon={<LuRefreshCw size={12} />}
          label='Restart'
          disabled={!isRunning}
          onClick={run(() => restart.mutate(pluginId))}
        />
      </div>
    </>
  );
}

function DetailRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className={styles.DetailRow}>
      <span className={styles.DetailLabel}>{label}:</span>
      <span className={cx(styles.DetailValue, mono && styles.Mono)} data-tone={tone}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DevServerChip — named chip per plugin with status dot + popover on click
// ---------------------------------------------------------------------------

function DevServerChip({ pluginId, state }: { pluginId: string; state: DevServerState }) {
  const aggStatus = getAggregateStatus(state);
  const tone = STATUS_TONE[aggStatus];
  const tooltipText = `${STATUS_LABELS[aggStatus]}${state.mode === 'external' ? ' (external)' : ''}${state.vitePort > 0 ? ` \u2022 Vite: :${state.vitePort}` : ''}`;

  return (
    <FooterPopover
      tooltip={tooltipText}
      width='narrow'
      trigger={
        <FooterTrigger>
          <span className={styles.Truncate}>{pluginId}</span>
          <Dot status={tone} pulse={aggStatus === 'building'} />
        </FooterTrigger>
      }
    >
      {(close) => <DevServerPopoverBody pluginId={pluginId} state={state} onClose={close} />}
    </FooterPopover>
  );
}

// ---------------------------------------------------------------------------
// DevServerIndicators — colored dots per dev server instance
// ---------------------------------------------------------------------------

function DevServerIndicators() {
  const { servers, summary } = useDevServers();

  if (summary.total === 0) return null;

  const tone: FooterTone = summary.error > 0 ? 'danger' : summary.building > 0 ? 'warning' : 'success';
  const entries = Array.from(servers.entries());

  return (
    <>
      <HintTooltip content={`${summary.total} dev server${summary.total !== 1 ? 's' : ''} active`} side='top'>
        <span className={styles.Chip} data-tone={tone} tabIndex={-1}>
          <LuPlug size={9} />
          DEV
        </span>
      </HintTooltip>
      {entries.map(([pluginId, state]) => (
        <DevServerChip key={pluginId} pluginId={pluginId} state={state} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// PluginLoadingSpinner — shows plugin install/reload/update status
// ---------------------------------------------------------------------------

function PluginLoadingSpinner() {
  const [loading, setLoading] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const cancelDevInstallStart = Events.On(
      'plugin/dev_install_start',
      (ev) => {
        const meta = ev.data;
        if (!meta) {
          return;
        }
        setLoading((prev) => ({
          ...prev,
          [meta.id]: `Installing plugin '${meta.name}' in development mode`,
        }));
      },
    );

    const cancelUpdateStart = Events.On(
      'plugin/update_started',
      (ev) => {
        const payload = ev.data as { pluginID: string; version: string };
        setLoading((prev) => ({
          ...prev,
          [payload.pluginID]: `Updating plugin '${payload.pluginID}' to '${payload.version}'`,
        }));
      },
    );

    const cancelInstallStart = Events.On(
      'plugin/install_started',
      (ev) => {
        const meta = ev.data;
        if (!meta) {
          return;
        }
        setLoading((prev) => ({
          ...prev,
          [meta.id]: `Installing plugin '${meta.name}'`,
        }));
      },
    );

    const cancelReloadStart = Events.On(
      'plugin/dev_reload_start',
      (ev) => {
        const meta = ev.data;
        if (!meta) {
          return;
        }
        setLoading((prev) => ({
          ...prev,
          [meta.id]: `Reloading plugin '${meta.name}'`,
        }));
      },
    );

    const clearLoading = (meta: PluginMeta | null) => {
      if (!meta) {
        return;
      }
      setLoading((prev) => ({ ...prev, [meta.id]: '' }));
    };

    const clearLoadingByEv = (ev: { data: PluginMeta | null }) => {
      clearLoading(ev.data);
    };

    const clearLoadingById = (id: string) => {
      setLoading((prev) => ({ ...prev, [id]: '' }));
    };

    const cancelReloadError = Events.On('plugin/dev_reload_error', (ev) => {
      clearLoading(ev.data[0] as PluginMeta | null);
    });
    const cancelReloadComplete = Events.On('plugin/dev_reload_complete', clearLoadingByEv);
    const cancelDevInstallError = Events.On('plugin/dev_install_error', clearLoadingByEv);
    const cancelDevInstallComplete = Events.On('plugin/dev_install_complete', clearLoadingByEv);
    const cancelInstallComplete = Events.On('plugin/install_complete', clearLoadingByEv);
    const cancelInstallFinished = Events.On('plugin/install_finished', (ev) => {
      clearLoading(ev.data);
    });
    const cancelInstallError = Events.On('plugin/install_error', (ev) => {
      clearLoading(ev.data);
    });
    const cancelUpdateError = Events.On('plugin/update_error', (ev) => {
      clearLoadingById(ev.data.pluginID);
    });
    const cancelUpdateComplete = Events.On('plugin/update_complete', (ev) => {
      clearLoadingById(ev.data.pluginID);
    });

    return () => {
      cancelDevInstallStart();
      cancelUpdateStart();
      cancelInstallStart();
      cancelReloadStart();
      cancelReloadError();
      cancelReloadComplete();
      cancelDevInstallError();
      cancelDevInstallComplete();
      cancelInstallComplete();
      cancelInstallFinished();
      cancelInstallError();
      cancelUpdateError();
      cancelUpdateComplete();
    };
  }, []);

  // Find the first active message
  const message = Object.values(loading).find(Boolean);

  if (!message) return null;

  return (
    <span className={styles.Spinner}>
      <Spinner size='xs' />
      <span>{message}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// NotificationButton — placeholder bell icon
// ---------------------------------------------------------------------------

function NotificationButton() {
  return (
    <HintTooltip content='Notifications' side='top'>
      <button type='button' className={styles.IconButton} aria-label='Notifications'>
        <LuBell size={10} />
      </button>
    </HintTooltip>
  );
}

// ---------------------------------------------------------------------------
// FailedPluginIndicator — red chip + popover listing plugin load errors
// ---------------------------------------------------------------------------

function FailedPluginIndicator() {
  const { plugins, retry } = usePluginService();

  const failedPlugins = React.useMemo(
    () =>
      Array.from(plugins.values())
        .filter((p) => p.phase === 'error')
        .map((p) => ({ pluginId: p.id, error: p.error ?? '' })),
    [plugins],
  );

  if (failedPlugins.length === 0) return null;

  const label = `${failedPlugins.length} plugin${failedPlugins.length !== 1 ? 's' : ''} failed`;

  return (
    <FooterPopover
      tooltip={label}
      trigger={<FooterChip tone='danger' icon={<LuTriangleAlert size={9} />} label={`${failedPlugins.length} failed`} />}
    >
      {(close) => (
        <>
          <PopoverHeader
            icon={<LuTriangleAlert size={12} className={styles.DangerIcon} />}
            title={`Failed Plugins (${failedPlugins.length})`}
          />
          <div className={styles.List} data-size='sm'>
            {failedPlugins.map((f) => (
              <div key={f.pluginId} className={styles.ListItem}>
                <div className={styles.Row}>
                  <span className={styles.Title}>{f.pluginId}</span>
                  <PopoverAction
                    icon={<LuRefreshCw size={11} />}
                    label='Retry'
                    onClick={() => {
                      void retry(f.pluginId);
                      close();
                    }}
                  />
                </div>
                <div className={styles.ErrorBox}>{f.error}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </FooterPopover>
  );
}

// ---------------------------------------------------------------------------
// PortForwardIndicator — green chip + popover listing active port forwards
// ---------------------------------------------------------------------------

function PortForwardList({ onClose }: { onClose: () => void }) {
  const { activeSessions, closeSession, openInBrowser } = usePortForwardSessions();

  const handleClose = async (sessionID: string) => {
    await closeSession(sessionID);
    if (activeSessions.length <= 1) onClose();
  };

  return (
    <>
      <PopoverHeader
        icon={<LuNetwork size={12} className={styles.SuccessIcon} />}
        title={`Port Forwards (${activeSessions.length})`}
      />
      <div className={styles.List}>
        {activeSessions.map((session) => {
          if (!session) return null;
          const conn = session.connection as Record<string, any> | undefined;
          const resourceId = conn?.resource_id ?? '';
          return (
            <div key={session.id} className={styles.ListItem}>
              <div className={styles.Row}>
                <div className={styles.Stack}>
                  <span className={cx(styles.Title, styles.Mono, styles.Truncate)}>
                    localhost:{session.local_port} → :{session.remote_port}
                  </span>
                  {resourceId && (
                    <span className={cx(styles.Meta, styles.Truncate)}>
                      {resourceId} / {session.protocol}
                    </span>
                  )}
                </div>
                <div className={styles.RowActions}>
                  <PopoverAction
                    icon={<LuExternalLink size={11} />}
                    label='Open'
                    onClick={() => openInBrowser(session.local_port)}
                  />
                  <PopoverAction
                    icon={<LuX size={11} />}
                    label='Close'
                    tone='danger'
                    onClick={() => void handleClose(session.id)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function PortForwardIndicator() {
  const { activeSessions } = usePortForwardSessions();

  if (activeSessions.length === 0) return null;

  const label = `${activeSessions.length} forward${activeSessions.length !== 1 ? 's' : ''}`;

  return (
    <FooterPopover
      tooltip={label}
      trigger={<FooterChip tone='success' icon={<LuNetwork size={9} />} label={label} />}
    >
      {(close) => <PortForwardList onClose={close} />}
    </FooterPopover>
  );
}

// ---------------------------------------------------------------------------
// OperationsIndicator — chip + popover listing active/recent operations
// ---------------------------------------------------------------------------

function OperationsList({ operations, onRemove }: { operations: Operation[]; onRemove: (id: string) => void }) {
  const running = operations.filter((o) => o.status === 'running');

  return (
    <>
      <PopoverHeader
        icon={<LuRefreshCw size={12} className={styles.InfoIcon} />}
        title={`Operations (${running.length} active)`}
      />
      <div className={styles.List}>
        {operations.length === 0 && <div className={styles.Empty}>No recent operations</div>}
        {operations.map((op) => {
          const elapsed = Math.round(((op.completedAt ?? Date.now()) - op.startedAt) / 1000);
          const status = op.status === 'completed' ? 'success' : op.status === 'error' ? 'danger' : 'warning';
          return (
            <div key={op.id} className={styles.ListItem}>
              <div className={styles.Row}>
                <div className={styles.Group}>
                  <Dot status={status} pulse={op.status === 'running'} />
                  <span className={cx(styles.Title, styles.Truncate)}>{op.label}</span>
                </div>
                <div className={styles.Group}>
                  <span className={cx(styles.Meta, styles.Mono)}>{elapsed}s</span>
                  {op.status !== 'running' && (
                    <PopoverAction icon={<LuX size={10} />} label='' onClick={() => onRemove(op.id)} />
                  )}
                </div>
              </div>
              {op.namespace && (
                <div className={cx(styles.Meta, styles.Indent, styles.Truncate)}>{op.namespace}</div>
              )}
              {op.progress && (
                <div className={cx(styles.Detail, styles.Indent)}>
                  {op.progress.ready}/{op.progress.desired} replicas ready
                </div>
              )}
              {op.message && !op.progress && (
                <div className={cx(styles.Detail, styles.Indent)}>{op.message}</div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function OperationsIndicator() {
  const { operations, removeOperation } = useOperations();

  const running = operations.filter((o) => o.status === 'running');

  if (operations.length === 0) return null;

  const label = running.length > 0
    ? `${running.length} operation${running.length !== 1 ? 's' : ''}`
    : `${operations.length} recent`;

  return (
    <FooterPopover
      tooltip={label}
      trigger={<FooterChip tone={running.length > 0 ? 'info' : 'neutral'} icon={<LuRefreshCw size={9} />} label={label} />}
    >
      {() => <OperationsList operations={operations} onRemove={removeOperation} />}
    </FooterPopover>
  );
}

// ---------------------------------------------------------------------------
// AppStatusFooter — main exported component
// ---------------------------------------------------------------------------

export default function AppStatusFooter() {
  return (
    <StatusBar data-testid='app-footer' size='sm' className={styles.Bar}>
      <StatusBar.Section align='start'>
        <DevModeChip />
        {import.meta.env.DEV && <StatusBar.Separator />}
        <DevServerIndicators />
        <FailedPluginIndicator />
        <PortForwardIndicator />
        <OperationsIndicator />
      </StatusBar.Section>
      <StatusBar.Section align='end'>
        <ConnectionStatusIndicator />
        <PluginLoadingSpinner />
        <StatusBar.Separator />
        <NotificationButton />
      </StatusBar.Section>
    </StatusBar>
  );
}
