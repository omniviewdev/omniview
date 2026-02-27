import React from 'react';
import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import Popover from '@mui/material/Popover';
import MuiTooltip from '@mui/material/Tooltip';
import { IDEStatusFooter } from '@omniviewdev/ui/feedback';
import { Chip } from '@omniviewdev/ui';
import {
  LuPlug,
  LuBell,
  LuHammer,
  LuSquare,
  LuPlay,
  LuRefreshCw,
  LuCircle,
  LuTriangleAlert,
  LuNetwork,
  LuExternalLink,
  LuX,
} from 'react-icons/lu';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import type { config } from '@omniviewdev/runtime/models';

import { useDevServers } from '@/features/devtools/useDevServers';
import { devToolsChannel } from '@/features/devtools/events';
import type { DevServerAggregateStatus, DevServerState } from '@/features/devtools/types';
import { getAggregateStatus } from '@/features/devtools/types';
import { useDevServer } from '@/hooks/plugin/useDevServer';
import { usePluginRegistry } from '@/features/plugins/usePluginRegistry';
import { usePortForwardSessions, useOperations } from '@omniviewdev/runtime';
import type { Operation } from '@omniviewdev/runtime';

import ConnectionStatusIndicator from './ConnectionStatusIndicator';

// ---------------------------------------------------------------------------
// Color mapping
// ---------------------------------------------------------------------------

const STATUS_DOT_CSS: Record<DevServerAggregateStatus, string> = {
  ready: '#3fb950',
  building: '#d29922',
  error: '#f85149',
  stopped: '#8b949e',
  connecting: '#58a6ff',
};

const CHIP_BG: Record<'success' | 'warning' | 'danger', string> = {
  success: 'var(--ov-success-default)',
  warning: 'var(--ov-warning-default)',
  danger: 'var(--ov-danger-default)',
};

const STATUS_LABELS: Record<DevServerAggregateStatus, string> = {
  ready: 'Ready',
  building: 'Building...',
  error: 'Error',
  stopped: 'Stopped',
  connecting: 'Connecting...',
};

const STATUS_CHIP_COLOR: Record<DevServerAggregateStatus, 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  ready: 'success',
  building: 'warning',
  error: 'error',
  stopped: 'neutral',
  connecting: 'info',
};

// ---------------------------------------------------------------------------
// DevModeChip — only visible in dev builds
// ---------------------------------------------------------------------------

function DevModeChip() {
  if (!import.meta.env.DEV) return null;
  return (
    <IDEStatusFooter.Chip
      label="DEVELOPMENT MODE"
      bgColor="#b08800"
      color="#fff"
      tooltip="Running in development mode"
    />
  );
}

// ---------------------------------------------------------------------------
// DevServerPopover — rich popover shown when clicking a dev server dot
// ---------------------------------------------------------------------------

interface DevServerPopoverProps {
  pluginId: string;
  state: DevServerState;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

function DevServerPopover({ pluginId, state, anchorEl, onClose }: DevServerPopoverProps) {
  const { start, stop, restart } = useDevServer(pluginId);
  const aggStatus = getAggregateStatus(state);
  const isRunning = aggStatus === 'ready' || aggStatus === 'building' || aggStatus === 'connecting' || aggStatus === 'error';
  const dotColor = STATUS_DOT_CSS[aggStatus];

  const handleLogs = () => {
    devToolsChannel.emit('onOpenBuildOutput', pluginId);
    onClose();
  };

  const handleStop = () => {
    stop.mutate(pluginId);
    onClose();
  };

  const handleStart = () => {
    start.mutate(pluginId);
    onClose();
  };

  const handleRestart = () => {
    restart.mutate(pluginId);
    onClose();
  };

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--ov-bg-elevated, #1c2128)',
            border: '1px solid var(--ov-border-default, #30363d)',
            borderRadius: '8px',
            p: 0,
            minWidth: 260,
            maxWidth: 320,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            color: 'var(--ov-fg-default, #c9d1d9)',
          },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 1,
          borderBottom: '1px solid var(--ov-border-default, #30363d)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              fontFamily: 'var(--ov-font-ui)',
              color: 'var(--ov-fg-base, #e6edf3)',
            }}
          >
            {pluginId}
          </Box>
          {state.mode === 'external' && (
            <Box
              sx={{
                fontSize: '0.5625rem',
                fontWeight: 600,
                px: '5px',
                py: '1px',
                borderRadius: '4px',
                border: '1px solid var(--ov-border-default, #30363d)',
                color: 'var(--ov-fg-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              External
            </Box>
          )}
        </Box>
        <Chip
          label={STATUS_LABELS[aggStatus]}
          color={STATUS_CHIP_COLOR[aggStatus]}
          emphasis="soft"
          size="xs"
          shape="rounded"
          textTransform="uppercase"
          icon={<LuCircle size={6} fill={dotColor} color={dotColor} />}
        />
      </Box>

      {/* Details */}
      <Box sx={{ px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {state.devPath && (
          <DetailRow label="Source" value={state.devPath} mono />
        )}
        {state.vitePort > 0 && (
          <DetailRow label="Vite" value={`http://127.0.0.1:${state.vitePort}`} mono />
        )}
        <DetailRow
          label="gRPC"
          value={state.grpcConnected ? 'Connected' : 'Disconnected'}
          valueColor={state.grpcConnected ? '#3fb950' : '#f85149'}
        />
        {state.lastError && (
          <Box
            sx={{
              mt: 0.5,
              p: 0.75,
              borderRadius: '4px',
              bgcolor: 'rgba(248,81,73,0.1)',
              border: '1px solid rgba(248,81,73,0.2)',
              fontSize: '0.6875rem',
              fontFamily: 'var(--ov-font-mono, monospace)',
              color: '#f85149',
              wordBreak: 'break-word',
              maxHeight: 60,
              overflow: 'auto',
            }}
          >
            {state.lastError}
          </Box>
        )}
      </Box>

      {/* Actions */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 1,
          py: 0.75,
          borderTop: '1px solid var(--ov-border-default, #30363d)',
        }}
      >
        <PopoverAction icon={<LuHammer size={12} />} label="Logs" onClick={handleLogs} />
        {isRunning ? (
          <PopoverAction
            icon={<LuSquare size={12} />}
            label="Stop"
            onClick={handleStop}
            color="#f85149"
          />
        ) : (
          <PopoverAction
            icon={<LuPlay size={12} />}
            label="Start"
            onClick={handleStart}
            color="#3fb950"
          />
        )}
        <PopoverAction
          icon={<LuRefreshCw size={12} />}
          label="Restart"
          onClick={handleRestart}
          disabled={!isRunning}
        />
      </Box>
    </Popover>
  );
}

function DetailRow({
  label,
  value,
  mono,
  valueColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
      <Box
        sx={{
          fontSize: '0.6875rem',
          color: 'var(--ov-fg-faint, #8b949e)',
          minWidth: 44,
          flexShrink: 0,
        }}
      >
        {label}:
      </Box>
      <Box
        sx={{
          fontSize: '0.6875rem',
          fontFamily: mono ? 'var(--ov-font-mono, monospace)' : 'inherit',
          color: valueColor ?? 'var(--ov-fg-muted, #8b949e)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function PopoverAction({
  icon,
  label,
  onClick,
  color,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <Box
      component="button"
      onClick={disabled ? undefined : onClick}
      sx={{
        all: 'unset',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '8px',
        py: '4px',
        fontSize: '0.6875rem',
        fontWeight: 500,
        fontFamily: 'var(--ov-font-ui)',
        color: disabled
          ? 'var(--ov-fg-faint, #484f58)'
          : color ?? 'var(--ov-fg-default, #c9d1d9)',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: '4px',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.5 : 1,
        '&:hover': disabled
          ? {}
          : { bgcolor: 'rgba(255,255,255,0.08)' },
        '&:active': disabled
          ? {}
          : { bgcolor: 'rgba(255,255,255,0.12)' },
      }}
    >
      {icon}
      {label}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// DevServerChip — named chip per plugin with status dot + popover on click
// ---------------------------------------------------------------------------

function DevServerChip({
  pluginId,
  state,
}: {
  pluginId: string;
  state: DevServerState;
}) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);
  const popoverOpen = Boolean(anchorEl);

  const aggStatus = getAggregateStatus(state);
  const dotColor = STATUS_DOT_CSS[aggStatus];
  const label = STATUS_LABELS[aggStatus];

  const tooltipText = `${label}${state.mode === 'external' ? ' (external)' : ''}${state.vitePort > 0 ? ` \u2022 Vite: :${state.vitePort}` : ''}`;

  const handleClick = () => {
    setAnchorEl(chipRef.current);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <MuiTooltip title={popoverOpen ? '' : tooltipText} enterDelay={400} placement="top">
        <Box
          ref={chipRef}
          onClick={handleClick}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            px: '6px',
            height: '100%',
            maxWidth: 120,
            fontSize: '0.625rem',
            fontWeight: 500,
            fontFamily: 'var(--ov-font-ui)',
            color: 'var(--ov-fg-default, #c9d1d9)',
            cursor: 'pointer',
            borderRadius: '2px',
            whiteSpace: 'nowrap',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
          }}
        >
          <Box
            component="span"
            sx={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {pluginId}
          </Box>
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: dotColor,
              flexShrink: 0,
              ...(aggStatus === 'building' && {
                animation: 'ov-footer-pulse 1.5s ease-in-out infinite',
                '@keyframes ov-footer-pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.3 },
                },
              }),
            }}
          />
        </Box>
      </MuiTooltip>
      <DevServerPopover
        pluginId={pluginId}
        state={state}
        anchorEl={anchorEl}
        onClose={handleClose}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// DevServerIndicators — colored dots per dev server instance
// ---------------------------------------------------------------------------

function DevServerIndicators() {
  const { servers, summary } = useDevServers();

  if (summary.total === 0) return null;

  const chipColor: 'success' | 'warning' | 'danger' =
    summary.error > 0 ? 'danger' : summary.building > 0 ? 'warning' : 'success';

  const entries = Array.from(servers.entries());

  return (
    <>
      <IDEStatusFooter.Chip
        label="DEV"
        icon={<LuPlug size={9} />}
        bgColor={CHIP_BG[chipColor]}
        tooltip={`${summary.total} dev server${summary.total !== 1 ? 's' : ''} active`}
      />
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
    const cancelDevInstallStart = EventsOn(
      'plugin/dev_install_start',
      (meta: config.PluginMeta) => {
        setLoading((prev) => ({
          ...prev,
          [meta.id]: `Installing plugin '${meta.name}' in development mode`,
        }));
      },
    );

    const cancelUpdateStart = EventsOn(
      'plugin/update_started',
      (id: string, version: string) => {
        setLoading((prev) => ({
          ...prev,
          [id]: `Updating plugin '${id}' to '${version}'`,
        }));
      },
    );

    const cancelInstallStart = EventsOn(
      'plugin/install_started',
      (meta: config.PluginMeta) => {
        setLoading((prev) => ({
          ...prev,
          [meta.id]: `Installing plugin '${meta.name}'`,
        }));
      },
    );

    const cancelReloadStart = EventsOn(
      'plugin/dev_reload_start',
      (meta: config.PluginMeta) => {
        setLoading((prev) => ({
          ...prev,
          [meta.id]: `Reloading plugin '${meta.name}'`,
        }));
      },
    );

    const clearLoading = (meta: config.PluginMeta) => {
      setLoading((prev) => ({ ...prev, [meta.id]: '' }));
    };

    const clearLoadingById = (id: string) => {
      setLoading((prev) => ({ ...prev, [id]: '' }));
    };

    const cancelReloadError = EventsOn('plugin/dev_reload_error', clearLoading);
    const cancelReloadComplete = EventsOn('plugin/dev_reload_complete', clearLoading);
    const cancelDevInstallError = EventsOn('plugin/dev_install_error', clearLoading);
    const cancelDevInstallComplete = EventsOn('plugin/dev_install_complete', clearLoading);
    const cancelInstallComplete = EventsOn('plugin/install_complete', clearLoading);
    const cancelInstallFinished = EventsOn('plugin/install_finished', (meta: config.PluginMeta) => {
      clearLoading(meta);
      clearLoadingById(meta.id);
    });
    const cancelInstallError = EventsOn('plugin/install_error', (meta: config.PluginMeta) => {
      clearLoading(meta);
      clearLoadingById(meta.id);
    });
    const cancelUpdateError = EventsOn('plugin/update_error', (id: string) => {
      clearLoadingById(id);
    });
    const cancelUpdateComplete = EventsOn('plugin/update_complete', (id: string) => {
      clearLoadingById(id);
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

  return <IDEStatusFooter.Spinner label={message} />;
}

// ---------------------------------------------------------------------------
// NotificationButton — placeholder bell icon
// ---------------------------------------------------------------------------

function NotificationButton() {
  return (
    <IDEStatusFooter.Button
      icon={<LuBell size={10} />}
      tooltip="Notifications"
    />
  );
}

// ---------------------------------------------------------------------------
// FailedPluginIndicator — red chip + popover listing plugin load errors
// ---------------------------------------------------------------------------

function FailedPluginPopover({
  failures,
  anchorEl,
  onClose,
  onRetry,
}: {
  failures: { pluginId: string; error: string }[];
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onRetry: (pluginId: string) => void;
}) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--ov-bg-elevated, #1c2128)',
            border: '1px solid var(--ov-border-default, #30363d)',
            borderRadius: '8px',
            p: 0,
            minWidth: 300,
            maxWidth: 400,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            color: 'var(--ov-fg-default, #c9d1d9)',
          },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: '1px solid var(--ov-border-default, #30363d)',
        }}
      >
        <LuTriangleAlert size={12} color="#f85149" />
        <Box
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'var(--ov-font-ui)',
            color: 'var(--ov-fg-base, #e6edf3)',
          }}
        >
          Failed Plugins ({failures.length})
        </Box>
      </Box>

      {/* Plugin list */}
      <Box sx={{ maxHeight: 240, overflow: 'auto' }}>
        {failures.map((f) => (
          <Box
            key={f.pluginId}
            sx={{
              px: 1.5,
              py: 1,
              borderBottom: '1px solid var(--ov-border-default, #30363d)',
              '&:last-child': { borderBottom: 'none' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Box
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  fontFamily: 'var(--ov-font-ui)',
                  color: 'var(--ov-fg-base, #e6edf3)',
                }}
              >
                {f.pluginId}
              </Box>
              <PopoverAction
                icon={<LuRefreshCw size={11} />}
                label="Retry"
                onClick={() => {
                  onRetry(f.pluginId);
                  onClose();
                }}
              />
            </Box>
            <Box
              sx={{
                p: 0.75,
                borderRadius: '4px',
                bgcolor: 'rgba(248,81,73,0.1)',
                border: '1px solid rgba(248,81,73,0.2)',
                fontSize: '0.6875rem',
                fontFamily: 'var(--ov-font-mono, monospace)',
                color: '#f85149',
                wordBreak: 'break-word',
                maxHeight: 48,
                overflow: 'auto',
              }}
            >
              {f.error}
            </Box>
          </Box>
        ))}
      </Box>
    </Popover>
  );
}

function FailedPluginIndicator() {
  const { failedPlugins, retryPlugin } = usePluginRegistry();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);

  if (failedPlugins.length === 0) return null;

  const label = `${failedPlugins.length} plugin${failedPlugins.length !== 1 ? 's' : ''} failed`;

  return (
    <>
      <MuiTooltip title={anchorEl ? '' : label} enterDelay={400} placement="top">
        <Box ref={chipRef} onClick={() => setAnchorEl(chipRef.current)}>
          <IDEStatusFooter.Chip
            label={`${failedPlugins.length} failed`}
            icon={<LuTriangleAlert size={9} />}
            bgColor="#f85149"
            color="#fff"
          />
        </Box>
      </MuiTooltip>
      <FailedPluginPopover
        failures={failedPlugins}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        onRetry={retryPlugin}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// PortForwardPopover — shows active port-forward sessions
// ---------------------------------------------------------------------------

function PortForwardPopover({
  anchorEl,
  onClose,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
}) {
  const { activeSessions, closeSession, openInBrowser } = usePortForwardSessions();

  const handleClose = async (sessionID: string) => {
    await closeSession(sessionID);
    if (activeSessions.length <= 1) onClose();
  };

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--ov-bg-elevated, #1c2128)',
            border: '1px solid var(--ov-border-default, #30363d)',
            borderRadius: '8px',
            p: 0,
            minWidth: 300,
            maxWidth: 400,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            color: 'var(--ov-fg-default, #c9d1d9)',
          },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: '1px solid var(--ov-border-default, #30363d)',
        }}
      >
        <LuNetwork size={12} color="#3fb950" />
        <Box
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'var(--ov-font-ui)',
            color: 'var(--ov-fg-base, #e6edf3)',
          }}
        >
          Port Forwards ({activeSessions.length})
        </Box>
      </Box>

      {/* Session list */}
      <Box sx={{ maxHeight: 280, overflow: 'auto' }}>
        {activeSessions.map((session) => {
          const conn = session.connection as Record<string, any> | undefined;
          const resourceId = conn?.resource_id ?? '';
          return (
            <Box
              key={session.id}
              sx={{
                px: 1.5,
                py: 0.75,
                borderBottom: '1px solid var(--ov-border-default, #30363d)',
                '&:last-child': { borderBottom: 'none' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                  <Box
                    sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      fontFamily: 'var(--ov-font-mono, monospace)',
                      color: 'var(--ov-fg-base, #e6edf3)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    localhost:{session.local_port} → :{session.remote_port}
                  </Box>
                  {resourceId && (
                    <Box
                      sx={{
                        fontSize: '0.625rem',
                        color: 'var(--ov-fg-faint, #8b949e)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {resourceId} / {session.protocol}
                    </Box>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
                  <PopoverAction
                    icon={<LuExternalLink size={11} />}
                    label="Open"
                    onClick={() => openInBrowser(session.local_port)}
                  />
                  <PopoverAction
                    icon={<LuX size={11} />}
                    label="Close"
                    onClick={() => handleClose(session.id)}
                    color="#f85149"
                  />
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// PortForwardIndicator — green chip when port forwards are active
// ---------------------------------------------------------------------------

function PortForwardIndicator() {
  const { activeSessions } = usePortForwardSessions();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);

  if (activeSessions.length === 0) return null;

  const label = `${activeSessions.length} forward${activeSessions.length !== 1 ? 's' : ''}`;

  return (
    <>
      <MuiTooltip title={anchorEl ? '' : label} enterDelay={400} placement="top">
        <Box ref={chipRef} onClick={() => setAnchorEl(chipRef.current)}>
          <IDEStatusFooter.Chip
            label={label}
            icon={<LuNetwork size={9} />}
            bgColor="#3fb950"
            color="#fff"
          />
        </Box>
      </MuiTooltip>
      <PortForwardPopover
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
      />
    </>
  );
}


// ---------------------------------------------------------------------------
// OperationsPopover — shows active/recent operations
// ---------------------------------------------------------------------------

function OperationsPopover({
  operations,
  anchorEl,
  onClose,
  onRemove,
}: {
  operations: Operation[];
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const running = operations.filter((o) => o.status === 'running');

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--ov-bg-elevated, #1c2128)',
            border: '1px solid var(--ov-border-default, #30363d)',
            borderRadius: '8px',
            p: 0,
            minWidth: 300,
            maxWidth: 400,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            color: 'var(--ov-fg-default, #c9d1d9)',
          },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: '1px solid var(--ov-border-default, #30363d)',
        }}
      >
        <LuRefreshCw size={12} color="#58a6ff" />
        <Box
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'var(--ov-font-ui)',
            color: 'var(--ov-fg-base, #e6edf3)',
          }}
        >
          Operations ({running.length} active)
        </Box>
      </Box>

      {/* Operation list */}
      <Box sx={{ maxHeight: 280, overflow: 'auto' }}>
        {operations.length === 0 && (
          <Box sx={{ px: 1.5, py: 1.5, fontSize: '0.75rem', color: 'var(--ov-fg-faint, #8b949e)' }}>
            No recent operations
          </Box>
        )}
        {operations.map((op) => {
          const elapsed = Math.round(((op.completedAt ?? Date.now()) - op.startedAt) / 1000);
          const dotColor = op.status === 'completed' ? '#3fb950' : op.status === 'error' ? '#f85149' : '#d29922';
          return (
            <Box
              key={op.id}
              sx={{
                px: 1.5,
                py: 0.75,
                borderBottom: '1px solid var(--ov-border-default, #30363d)',
                '&:last-child': { borderBottom: 'none' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                  <Box
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      bgcolor: dotColor,
                      flexShrink: 0,
                      ...(op.status === 'running' && {
                        animation: 'ov-footer-pulse 1.5s ease-in-out infinite',
                        '@keyframes ov-footer-pulse': {
                          '0%, 100%': { opacity: 1 },
                          '50%': { opacity: 0.3 },
                        },
                      }),
                    }}
                  />
                  <Box
                    sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      fontFamily: 'var(--ov-font-ui)',
                      color: 'var(--ov-fg-base, #e6edf3)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {op.label}
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                  <Box
                    sx={{
                      fontSize: '0.625rem',
                      color: 'var(--ov-fg-faint, #8b949e)',
                      fontFamily: 'var(--ov-font-mono, monospace)',
                    }}
                  >
                    {elapsed}s
                  </Box>
                  {op.status !== 'running' && (
                    <PopoverAction
                      icon={<LuX size={10} />}
                      label=""
                      onClick={() => onRemove(op.id)}
                    />
                  )}
                </Box>
              </Box>
              {op.namespace && (
                <Box
                  sx={{
                    fontSize: '0.625rem',
                    color: 'var(--ov-fg-faint, #8b949e)',
                    ml: 1.75,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {op.namespace}
                </Box>
              )}
              {op.progress && (
                <Box
                  sx={{
                    fontSize: '0.6875rem',
                    color: 'var(--ov-fg-muted, #8b949e)',
                    ml: 1.75,
                    mt: 0.25,
                  }}
                >
                  {op.progress.ready}/{op.progress.desired} replicas ready
                </Box>
              )}
              {op.message && !op.progress && (
                <Box
                  sx={{
                    fontSize: '0.6875rem',
                    color: 'var(--ov-fg-muted, #8b949e)',
                    ml: 1.75,
                    mt: 0.25,
                  }}
                >
                  {op.message}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// OperationsIndicator — shows when operations are active
// ---------------------------------------------------------------------------

function OperationsIndicator() {
  const { operations, removeOperation } = useOperations();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);

  const running = operations.filter((o) => o.status === 'running');

  if (operations.length === 0) return null;

  const label = running.length > 0
    ? `${running.length} operation${running.length !== 1 ? 's' : ''}`
    : `${operations.length} recent`;

  return (
    <>
      <MuiTooltip title={anchorEl ? '' : label} enterDelay={400} placement="top">
        <Box ref={chipRef} onClick={() => setAnchorEl(chipRef.current)}>
          <IDEStatusFooter.Chip
            label={label}
            icon={<LuRefreshCw size={9} />}
            bgColor={running.length > 0 ? '#58a6ff' : '#8b949e'}
            color="#fff"
          />
        </Box>
      </MuiTooltip>
      <OperationsPopover
        operations={operations}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        onRemove={removeOperation}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// AppStatusFooter — main exported component
// ---------------------------------------------------------------------------

export default function AppStatusFooter() {
  return (
    <>
      <GlobalStyles
        styles={{
          ':root': {
            '--CoreLayoutFooter-height': '24px',
          },
        }}
      />
      <IDEStatusFooter
        height={24}
        left={
          <>
            <DevModeChip />
            {import.meta.env.DEV && <IDEStatusFooter.Separator />}
            <DevServerIndicators />
            <FailedPluginIndicator />
            <PortForwardIndicator />
            <OperationsIndicator />
          </>
        }
        right={
          <>
            <ConnectionStatusIndicator />
            <PluginLoadingSpinner />
            <IDEStatusFooter.Separator />
            <NotificationButton />
          </>
        }
      />
    </>
  );
}
