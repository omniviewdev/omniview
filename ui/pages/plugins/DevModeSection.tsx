import React from 'react';
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { LuCircle, LuExternalLink, LuHammer, LuPlay, LuRefreshCw, LuSquare } from 'react-icons/lu';

import { devToolsChannel } from '@/features/devtools/events';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';
import type { DevServerAggregateStatus } from '@/features/devtools/types';
import { useDevServer } from '@/hooks/plugin/useDevServer';

interface Props {
  pluginId: string;
  devPath: string;
}

const STATUS_LABELS: Record<DevServerAggregateStatus, string> = {
  ready: 'Ready',
  building: 'Building',
  error: 'Error',
  stopped: 'Stopped',
  connecting: 'Connecting',
};

const DOT_CSS: Record<DevServerAggregateStatus, string> = {
  ready: '#3fb950',
  building: '#d29922',
  error: '#f85149',
  stopped: '#8b949e',
  connecting: '#58a6ff',
};

/**
 * Dev mode section displayed inside InstalledPluginCard when the plugin is in dev mode.
 * Shows dev server status, controls, and build information.
 */
const DevModeSection: React.FC<Props> = ({ pluginId, devPath }) => {
  const { state, start, stop, restart } = useDevServer(pluginId);

  const aggStatus = state.data ? getAggregateStatus(state.data) : 'stopped';
  const isRunning = aggStatus === 'ready' || aggStatus === 'building' || aggStatus === 'connecting' || aggStatus === 'error';
  const dotColor = DOT_CSS[aggStatus];

  return (
    <Box
      sx={{
        mt: 0.5,
        borderRadius: '6px',
        border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
        bgcolor: 'var(--ov-bg-surface-inset, rgba(0,0,0,0.15))',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderBottom: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
          <Box
            component="span"
            sx={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--ov-fg-base)',
              whiteSpace: 'nowrap',
            }}
          >
            Dev Server
          </Box>
          <Chip
            size="xs"
            color={STATUS_COLORS[aggStatus]}
            emphasis="soft"
            shape="rounded"
            textTransform="uppercase"
            icon={<LuCircle size={6} fill={dotColor} color={dotColor} />}
            label={STATUS_LABELS[aggStatus]}
          />
          {state.data?.mode === 'external' && (
            <Chip
              size="xs"
              color="neutral"
              emphasis="outline"
              shape="rounded"
              icon={<LuExternalLink size={10} />}
              label="External"
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
          <ActionBtn icon={<LuHammer size={12} />} label="Logs" onClick={() => devToolsChannel.emit('onOpenBuildOutput', pluginId)} />
          {isRunning ? (
            <ActionBtn icon={<LuSquare size={12} />} label="Stop" onClick={() => stop.mutate(pluginId)} color="var(--ov-danger-default, #f85149)" />
          ) : (
            <ActionBtn icon={<LuPlay size={12} />} label="Start" onClick={() => start.mutate(pluginId)} color="var(--ov-success-default, #3fb950)" />
          )}
          <ActionBtn icon={<LuRefreshCw size={12} />} label="Restart" onClick={() => restart.mutate(pluginId)} disabled={!isRunning} />
        </Box>
      </Box>

      {/* Details */}
      <Box sx={{ px: 1.25, py: 0.75, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <DetailRow label="Source" value={devPath} mono />
        {state.data?.vitePort != null && state.data.vitePort > 0 && (
          <DetailRow label="Vite" value={`http://127.0.0.1:${state.data.vitePort}`} mono />
        )}
        {state.data && (
          <DetailRow
            label="gRPC"
            value={state.data.grpcConnected ? 'Connected' : 'Disconnected'}
            valueColor={state.data.grpcConnected ? 'var(--ov-success-default, #3fb950)' : 'var(--ov-danger-default, #f85149)'}
          />
        )}
        {state.data?.lastError && (
          <Box
            sx={{
              mt: '2px',
              p: 0.5,
              borderRadius: '4px',
              bgcolor: 'rgba(248,81,73,0.08)',
              border: '1px solid rgba(248,81,73,0.15)',
              fontSize: '0.6875rem',
              fontFamily: 'var(--ov-font-mono, monospace)',
              color: '#f85149',
              wordBreak: 'break-word',
              maxHeight: 48,
              overflow: 'auto',
            }}
          >
            {state.data.lastError}
          </Box>
        )}
      </Box>
    </Box>
  );
};

function DetailRow({ label, value, mono, valueColor }: { label: string; value: string; mono?: boolean; valueColor?: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', minWidth: 0 }}>
      <Box
        component="span"
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
        component="span"
        sx={{
          fontSize: '0.6875rem',
          fontFamily: mono ? 'var(--ov-font-mono, monospace)' : 'inherit',
          color: valueColor ?? 'var(--ov-fg-muted, #8b949e)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function ActionBtn({ icon, label, onClick, color, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; color?: string; disabled?: boolean }) {
  return (
    <Box
      component="button"
      onClick={disabled ? undefined : onClick}
      sx={{
        all: 'unset',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '6px',
        py: '3px',
        fontSize: '0.6875rem',
        fontWeight: 500,
        fontFamily: 'var(--ov-font-ui)',
        color: disabled ? 'var(--ov-fg-faint, #484f58)' : color ?? 'var(--ov-fg-default, #c9d1d9)',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: '4px',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.5 : 1,
        '&:hover': disabled ? {} : { bgcolor: 'rgba(255,255,255,0.06)' },
      }}
    >
      {icon}
      {label}
    </Box>
  );
}

export default React.memo(DevModeSection);
