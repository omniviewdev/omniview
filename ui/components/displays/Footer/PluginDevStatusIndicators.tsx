import React from 'react';
import Chip from '@mui/joy/Chip';
import Stack from '@mui/joy/Stack';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';
import { LuCircle, LuPlug } from 'react-icons/lu';

import { useDevServers } from '@/features/devtools/useDevServers';
import { devToolsChannel } from '@/features/devtools/events';
import type { DevServerAggregateStatus } from '@/features/devtools/types';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';

const DOT_COLORS: Record<DevServerAggregateStatus, string> = {
  ready: 'var(--joy-palette-success-400)',
  building: 'var(--joy-palette-warning-400)',
  error: 'var(--joy-palette-danger-400)',
  stopped: 'var(--joy-palette-neutral-400)',
  connecting: 'var(--joy-palette-primary-400)',
};

const STATUS_LABELS: Record<DevServerAggregateStatus, string> = {
  ready: 'Ready',
  building: 'Building...',
  error: 'Error',
  stopped: 'Stopped',
  connecting: 'Connecting...',
};

/**
 * Footer component that shows colored dots for each active dev server instance.
 * Clicking a dot opens the build output tab for that plugin.
 */
const PluginDevStatusIndicators: React.FC = () => {
  const { servers, summary } = useDevServers();

  if (summary.total === 0) return null;

  const handleClick = (pluginId: string) => {
    devToolsChannel.emit('onOpenBuildOutput', pluginId);
  };

  const entries = Array.from(servers.entries());

  return (
    <Stack direction="row" alignItems="center" gap={0.5}>
      <Tooltip
        title={
          <Typography level="body-xs">
            {summary.total} dev server{summary.total !== 1 ? 's' : ''} active
          </Typography>
        }
        size="sm"
        variant="soft"
      >
        <Chip
          size="sm"
          variant="soft"
          color={summary.error > 0 ? 'danger' : summary.building > 0 ? 'warning' : 'success'}
          startDecorator={<LuPlug size={10} />}
          sx={{
            '--Chip-minHeight': '16px',
            '--Chip-radius': '4px',
            fontSize: '10px',
            fontWeight: 600,
            cursor: 'default',
          }}
        >
          DEV
        </Chip>
      </Tooltip>

      {entries.map(([pluginId, state]) => {
        const aggStatus = getAggregateStatus(state);
        const color = DOT_COLORS[aggStatus];
        const label = STATUS_LABELS[aggStatus];

        return (
          <Tooltip
            key={pluginId}
            title={
              <Stack gap={0.25}>
                <Typography level="body-xs" fontWeight={600}>
                  {pluginId}
                </Typography>
                <Typography level="body-xs">
                  {label}
                  {state.mode === 'external' ? ' (external)' : ''}
                </Typography>
                {state.vitePort > 0 && (
                  <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                    Vite: :{state.vitePort}
                  </Typography>
                )}
              </Stack>
            }
            size="sm"
            variant="outlined"
            placement="top"
          >
            <Stack
              component="button"
              onClick={() => handleClick(pluginId)}
              sx={{
                all: 'unset',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 14,
                height: 14,
                borderRadius: '50%',
                '&:hover': { bgcolor: 'background.level1' },
                ...(aggStatus === 'building' && {
                  animation: 'pulse 1.5s ease-in-out infinite',
                  '@keyframes pulse': {
                    '0%, 100%': { opacity: 1 },
                    '50%': { opacity: 0.4 },
                  },
                }),
              }}
            >
              <LuCircle size={8} fill={color} color={color} />
            </Stack>
          </Tooltip>
        );
      })}
    </Stack>
  );
};

export default React.memo(PluginDevStatusIndicators);
