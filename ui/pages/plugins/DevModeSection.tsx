import React from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Chip from '@mui/joy/Chip';
import Divider from '@mui/joy/Divider';
import Stack from '@mui/joy/Stack';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';
import { LuCircle, LuExternalLink, LuHammer, LuPlay, LuRefreshCw, LuSquare } from 'react-icons/lu';

import { devToolsChannel } from '@/features/devtools/events';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';
import { useDevServer } from '@/hooks/plugin/useDevServer';

interface Props {
  pluginId: string;
  devPath: string;
}

/**
 * Dev mode section displayed inside InstalledPluginCard when the plugin is in dev mode.
 * Shows dev server status, controls, and build information.
 */
const DevModeSection: React.FC<Props> = ({ pluginId, devPath }) => {
  const { state, start, stop, restart } = useDevServer(pluginId);

  const aggStatus = state.data ? getAggregateStatus(state.data) : 'stopped';
  const isRunning = aggStatus === 'ready' || aggStatus === 'building' || aggStatus === 'connecting' || aggStatus === 'error';

  return (
    <Box
      sx={{
        mt: 1,
        p: 1.5,
        borderRadius: 'sm',
        bgcolor: 'background.level1',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography level="title-sm">Dev Server</Typography>
          <Chip
            size="sm"
            variant="soft"
            color={STATUS_COLORS[aggStatus]}
            startDecorator={<LuCircle size={6} />}
            sx={{ '--Chip-minHeight': '18px', fontSize: '10px' }}
          >
            {aggStatus.toUpperCase()}
          </Chip>
          {state.data?.mode === 'external' && (
            <Chip
              size="sm"
              variant="outlined"
              color="neutral"
              startDecorator={<LuExternalLink size={10} />}
              sx={{ '--Chip-minHeight': '18px', fontSize: '10px' }}
            >
              External
            </Chip>
          )}
        </Stack>

        <Stack direction="row" gap={0.5}>
          <Tooltip title="View build output" size="sm">
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              startDecorator={<LuHammer size={14} />}
              onClick={() => devToolsChannel.emit('onOpenBuildOutput', pluginId)}
              sx={{ fontSize: '12px' }}
            >
              Logs
            </Button>
          </Tooltip>
          {isRunning ? (
            <Tooltip title="Stop dev server" size="sm">
              <Button
                size="sm"
                variant="plain"
                color="danger"
                startDecorator={<LuSquare size={14} />}
                loading={stop.isPending}
                onClick={() => stop.mutate(pluginId)}
                sx={{ fontSize: '12px' }}
              >
                Stop
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="Start dev server" size="sm">
              <Button
                size="sm"
                variant="plain"
                color="success"
                startDecorator={<LuPlay size={14} />}
                loading={start.isPending}
                onClick={() => start.mutate(pluginId)}
                sx={{ fontSize: '12px' }}
              >
                Start
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Restart dev server" size="sm">
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              startDecorator={<LuRefreshCw size={14} />}
              loading={restart.isPending}
              disabled={!isRunning}
              onClick={() => restart.mutate(pluginId)}
              sx={{ fontSize: '12px' }}
            >
              Restart
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      <Divider sx={{ mb: 1 }} />

      <Stack gap={0.5}>
        <Stack direction="row" gap={1}>
          <Typography level="body-xs" sx={{ color: 'text.tertiary', minWidth: 60 }}>
            Source:
          </Typography>
          <Typography level="body-xs" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
            {devPath}
          </Typography>
        </Stack>

        {state.data?.vitePort != null && state.data.vitePort > 0 && (
          <Stack direction="row" gap={1}>
            <Typography level="body-xs" sx={{ color: 'text.tertiary', minWidth: 60 }}>
              Vite:
            </Typography>
            <Typography level="body-xs" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
              http://127.0.0.1:{state.data.vitePort}
            </Typography>
          </Stack>
        )}

        {state.data && (
          <Stack direction="row" gap={1}>
            <Typography level="body-xs" sx={{ color: 'text.tertiary', minWidth: 60 }}>
              gRPC:
            </Typography>
            <Typography
              level="body-xs"
              sx={{ color: state.data.grpcConnected ? 'success.plainColor' : 'danger.plainColor' }}
            >
              {state.data.grpcConnected ? 'Connected' : 'Disconnected'}
            </Typography>
          </Stack>
        )}

        {state.data?.lastError && (
          <Typography
            level="body-xs"
            sx={{
              color: 'danger.plainColor',
              fontFamily: 'monospace',
              mt: 0.5,
              p: 0.5,
              bgcolor: 'danger.softBg',
              borderRadius: 'xs',
            }}
          >
            {state.data.lastError}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};

export default React.memo(DevModeSection);
