import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Button } from '@omniviewdev/ui/buttons';
import { Card } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { LuTriangleAlert, LuX, LuRefreshCw } from 'react-icons/lu';

import { devToolsChannel } from '@/features/devtools/events';
import type { DevBuildError, DevServerState } from '@/features/devtools/types';

interface Props {
  pluginId: string;
  dismissable?: boolean;
}

/**
 * Error overlay displayed on top of a plugin's render area when build errors occur.
 * Shows structured error messages with file/line/column information.
 */
const PluginDevOverlay: React.FC<Props> = ({ pluginId, dismissable = true }) => {
  const [errors, setErrors] = useState<DevBuildError[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const unsubError = devToolsChannel.on('onBuildError', (payload) => {
      if (payload.pluginId !== pluginId) return;
      setErrors(payload.errors);
      setHasError(true);
      setDismissed(false);
    });

    const unsubStatus = devToolsChannel.on('onStatusChange', (state: DevServerState) => {
      if (state.pluginID !== pluginId) return;
      if (state.goStatus === 'ready' && !state.lastError) {
        setErrors([]);
        setHasError(false);
      }
    });

    return () => {
      unsubError();
      unsubStatus();
    };
  }, [pluginId]);

  if (!hasError || dismissed || errors.length === 0) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <Card
        sx={{
          maxWidth: 600,
          maxHeight: '80%',
          overflow: 'auto',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'error.main',
        }}
      >
        <Stack direction="row" align="center" justify="between">
          <Stack direction="row" align="center" gap={1}>
            <LuTriangleAlert size={18} color="var(--joy-palette-danger-400)" />
            <Text weight="semibold" sx={{ color: 'error.main' }}>
              Build Error
            </Text>
            <Text size="xs" sx={{ color: 'text.secondary' }}>
              {pluginId}
            </Text>
          </Stack>
          {dismissable && (
            <Button
              size="sm"
              emphasis="ghost"
              color="neutral"
              onClick={() => setDismissed(true)}
              sx={{ minWidth: 0, minHeight: 0, p: 0.5 }}
            >
              <LuX size={16} />
            </Button>
          )}
        </Stack>

        <Divider sx={{ my: 1 }} />

        <Stack gap={1}>
          {errors.map((err, i) => (
            <Box
              key={i}
              sx={{
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
            >
              <Text
                size="xs"
                sx={{ color: 'text.secondary', mb: 0.5, fontFamily: 'inherit' }}
              >
                {err.file}:{err.line}:{err.column}
              </Text>
              <Text
                size="sm"
                sx={{
                  color: err.severity === 'error' ? 'error.main' : 'warning.main',
                  fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {err.message}
              </Text>
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 1 }} />

        <Stack direction="row" gap={1} justify="end">
          <Button
            size="sm"
            emphasis="ghost"
            color="neutral"
            onClick={() => devToolsChannel.emit('onOpenBuildOutput', pluginId)}
          >
            View Full Logs
          </Button>
          <Button
            size="sm"
            emphasis="soft"
            color="primary"
            startAdornment={<LuRefreshCw size={14} />}
            onClick={() => devToolsChannel.emit('onRestartDevServer', pluginId)}
          >
            Restart
          </Button>
        </Stack>
      </Card>
    </Box>
  );
};

export default React.memo(PluginDevOverlay);
