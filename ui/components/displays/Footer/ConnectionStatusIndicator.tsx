import React from 'react';
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import LinearProgress from '@mui/material/LinearProgress';
import MuiTooltip from '@mui/material/Tooltip';
import { IDEStatusFooter } from '@omniviewdev/ui/feedback';
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

// ---------------------------------------------------------------------------
// PopoverAction — reusable small button for popover rows
// ---------------------------------------------------------------------------

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
// PluginGroupHeader — uppercase group label per plugin
// ---------------------------------------------------------------------------

function PluginGroupHeader({ pluginID }: { pluginID: string }) {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.5,
        fontSize: '0.625rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--ov-fg-faint, #8b949e)',
        bgcolor: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid var(--ov-border-default, #30363d)',
      }}
    >
      {pluginID}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// ConnectionRow — per-connection status, progress, and actions
// ---------------------------------------------------------------------------

function ConnectionRow({
  entry,
  onDisconnect,
  onRetry,
}: {
  entry: ConnectionStatusEntry;
  onDisconnect: (pluginID: string, connectionID: string) => void;
  onRetry: (pluginID: string, connectionID: string) => void;
}) {
  const { pluginID, connectionID, name, sync, isSyncing, hasErrors } = entry;

  const dotColor = hasErrors
    ? '#f85149'
    : isSyncing
      ? '#58a6ff'
      : '#3fb950';

  const statusText = isSyncing && sync
    ? `Syncing ${sync.doneCount}/${sync.totalResources} resources`
    : hasErrors && sync
      ? `${sync.errorCount} error${sync.errorCount !== 1 ? 's' : ''}`
      : sync && sync.totalResources > 0
        ? `Connected \u00B7 ${sync.totalResources} resources`
        : 'Connected';

  const percent = sync ? Math.round(sync.progress * 100) : 0;

  const handleDetails = () => {
    window.dispatchEvent(
      new CustomEvent('ov:show-sync-modal', {
        detail: { connectionID },
      }),
    );
  };

  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        borderBottom: '1px solid var(--ov-border-default, #30363d)',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      {/* Name + status dot */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: dotColor,
            flexShrink: 0,
            ...(isSyncing && {
              animation: 'ov-conn-pulse 1.5s ease-in-out infinite',
              '@keyframes ov-conn-pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.4 },
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
          {name}
        </Box>
      </Box>

      {/* Status text */}
      <Box
        sx={{
          fontSize: '0.6875rem',
          color: 'var(--ov-fg-muted, #8b949e)',
          pl: '19px',
          mb: isSyncing ? 0.5 : 0,
        }}
      >
        {statusText}
      </Box>

      {/* Progress bar when syncing */}
      {isSyncing && (
        <Box sx={{ pl: '19px', mb: 0.5 }}>
          <LinearProgress
            variant="determinate"
            value={percent}
            sx={{
              height: 3,
              borderRadius: 1.5,
              bgcolor: 'rgba(255,255,255,0.1)',
              '& .MuiLinearProgress-bar': {
                bgcolor: '#58a6ff',
                borderRadius: 1.5,
              },
            }}
          />
        </Box>
      )}

      {/* Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25, mt: 0.25 }}>
        {sync && (
          <PopoverAction
            icon={<LuInfo size={11} />}
            label="Details"
            onClick={handleDetails}
          />
        )}
        {hasErrors && (
          <PopoverAction
            icon={<LuRefreshCw size={11} />}
            label="Retry"
            onClick={() => onRetry(pluginID, connectionID)}
          />
        )}
        <PopoverAction
          icon={<LuUnplug size={11} />}
          label="Disconnect"
          onClick={() => onDisconnect(pluginID, connectionID)}
          color="#f85149"
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// ConnectionStatusPopover
// ---------------------------------------------------------------------------

function ConnectionStatusPopover({
  anchorEl,
  onClose,
  grouped,
  connectedCount,
  onDisconnect,
  onRetry,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  grouped: Map<string, ConnectionStatusEntry[]>;
  connectedCount: number;
  onDisconnect: (pluginID: string, connectionID: string) => void;
  onRetry: (pluginID: string, connectionID: string) => void;
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
            minWidth: 320,
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
        <LuPlug size={12} color="var(--ov-fg-muted, #8b949e)" />
        <Box
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'var(--ov-font-ui)',
            color: 'var(--ov-fg-base, #e6edf3)',
          }}
        >
          Active Connections ({connectedCount})
        </Box>
      </Box>

      {/* Connection list grouped by plugin */}
      <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
        {Array.from(grouped.entries()).map(([pluginID, pluginEntries]) => (
          <React.Fragment key={pluginID}>
            <PluginGroupHeader pluginID={pluginID} />
            {pluginEntries.map((entry) => (
              <ConnectionRow
                key={`${entry.pluginID}/${entry.connectionID}`}
                entry={entry}
                onDisconnect={onDisconnect}
                onRetry={onRetry}
              />
            ))}
          </React.Fragment>
        ))}
      </Box>
    </Popover>
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
    hasSyncing,
    aggregateProgress,
    disconnect,
    retryInformer,
  } = useConnectionStatus();

  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  // Nothing to show
  if (connectedCount === 0) return null;

  const dotColor = errorCount > 0 ? '#f85149' : hasSyncing ? '#58a6ff' : '#3fb950';
  const label = hasSyncing
    ? `${syncingCount} syncing`
    : `${connectedCount} connected`;

  const tooltipText = `${connectedCount} connection${connectedCount !== 1 ? 's' : ''} active`;

  return (
    <>
      <IDEStatusFooter.Separator />
      <MuiTooltip title={anchorEl ? '' : tooltipText} enterDelay={400} placement="top">
        <Box
          ref={ref}
          onClick={() => setAnchorEl(ref.current)}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            px: '6px',
            height: '100%',
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
          <LuPlug size={10} />
          <span>{label}</span>
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: dotColor,
              flexShrink: 0,
              ...(hasSyncing && {
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
      {/* Inline progress bar when syncing */}
      {hasSyncing && (
        <IDEStatusFooter.Progress
          value={Math.round(aggregateProgress * 100)}
          width={48}
          color="#58a6ff"
        />
      )}
      <ConnectionStatusPopover
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        grouped={grouped}
        connectedCount={connectedCount}
        onDisconnect={(p, c) => disconnect(p, c).catch(() => {})}
        onRetry={(p, c) => retryInformer(p, c).catch(() => {})}
      />
    </>
  );
}
