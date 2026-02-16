import React, { useEffect, useState } from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Card from '@mui/joy/Card';
import Divider from '@mui/joy/Divider';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';
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
        variant="outlined"
        sx={{
          maxWidth: 600,
          maxHeight: '80%',
          overflow: 'auto',
          bgcolor: 'background.surface',
          border: '1px solid',
          borderColor: 'danger.outlinedBorder',
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" gap={1}>
            <LuTriangleAlert size={18} color="var(--joy-palette-danger-400)" />
            <Typography level="title-md" sx={{ color: 'danger.plainColor' }}>
              Build Error
            </Typography>
            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
              {pluginId}
            </Typography>
          </Stack>
          {dismissable && (
            <Button
              size="sm"
              variant="plain"
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
                borderRadius: 'xs',
                bgcolor: 'background.level1',
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
            >
              <Typography
                level="body-xs"
                sx={{ color: 'text.tertiary', mb: 0.5, fontFamily: 'inherit' }}
              >
                {err.file}:{err.line}:{err.column}
              </Typography>
              <Typography
                level="body-sm"
                sx={{
                  color: err.severity === 'error' ? 'danger.plainColor' : 'warning.plainColor',
                  fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {err.message}
              </Typography>
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 1 }} />

        <Stack direction="row" gap={1} justifyContent="flex-end">
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            onClick={() => devToolsChannel.emit('onOpenBuildOutput', pluginId)}
          >
            View Full Logs
          </Button>
          <Button
            size="sm"
            variant="soft"
            color="primary"
            startDecorator={<LuRefreshCw size={14} />}
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
