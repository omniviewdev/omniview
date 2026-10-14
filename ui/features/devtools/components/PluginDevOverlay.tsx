import React, { useEffect, useState } from 'react';
import { Button, Card, IconButton, Separator, Stack, Text } from '@omniviewdev/base-ui';
import { LuTriangleAlert, LuX, LuRefreshCw } from 'react-icons/lu';

import { devToolsChannel } from '@/features/devtools/events';
import type { DevBuildError, DevServerState } from '@/features/devtools/types';
import { DevProcessStatus } from '@omniviewdev/runtime/models';
import styles from './PluginDevOverlay.module.css';

type Props = {
  pluginId: string;
  dismissable?: boolean;
};

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
      if (payload.pluginId !== pluginId) {
        return;
      }

      setErrors(payload.errors);
      setHasError(true);
      setDismissed(false);
    });

    const unsubStatus = devToolsChannel.on('onStatusChange', (state: DevServerState) => {
      if (state.pluginID !== pluginId) {
        return;
      }

      if (state.goStatus === DevProcessStatus.DevProcessStatusReady && !state.lastError) {
        setErrors([]);
        setHasError(false);
      }
    });

    return () => {
      unsubError();
      unsubStatus();
    };
  }, [pluginId]);

  if (!hasError || dismissed || errors.length === 0) {
    return null;
  }

  return (
    <div className={styles.Overlay}>
      <Card className={styles.Card}>
        <Stack direction="row" align="center" justify="between">
          <Stack direction="row" align="center" spacing={2}>
            <LuTriangleAlert size={18} className={styles.AlertIcon} />
            <Text weight="semibold" tone="danger">
              Build Error
            </Text>
            <Text size="xs" tone="muted">
              {pluginId}
            </Text>
          </Stack>
          {dismissable && (
            <IconButton
              size="sm"
              variant="ghost"
              color="neutral"
              aria-label="Dismiss"
              onClick={() => {
                setDismissed(true); 
              }}
            >
              <LuX size={16} />
            </IconButton>
          )}
        </Stack>

        <Separator className={styles.Divider} />

        <Stack spacing={2}>
          {errors.map((err, i) => (
            <div key={i} className={styles.ErrorItem}>
              <Text size="xs" tone="muted" className={styles.ErrorLocation}>
                {err.file}:{err.line}:{err.column}
              </Text>
              <Text
                size="sm"
                tone={err.severity === 'error' ? 'danger' : 'warning'}
                className={styles.ErrorMessage}
              >
                {err.message}
              </Text>
            </div>
          ))}
        </Stack>

        <Separator className={styles.Divider} />

        <Stack direction="row" spacing={2} justify="end">
          <Button
            size="sm"
            variant="ghost"
            color="neutral"
            onClick={() => {
              devToolsChannel.emit('onOpenBuildOutput', pluginId); 
            }}
          >
            View Full Logs
          </Button>
          <Button
            size="sm"
            variant="soft"
            color="brand"
            startDecorator={<LuRefreshCw size={14} />}
            onClick={() => {
              devToolsChannel.emit('onRestartDevServer', pluginId); 
            }}
          >
            Restart
          </Button>
        </Stack>
      </Card>
    </div>
  );
};

export default React.memo(PluginDevOverlay);
