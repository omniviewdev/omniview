import React from 'react';
import { Button, Heading, Text } from '@omniviewdev/base-ui';
import { LuCircleAlert, LuRefreshCw, LuRotateCcw } from 'react-icons/lu';
import { usePluginService } from '@/features/plugins';
import styles from './PluginLoadErrorPage.module.css';

interface PluginLoadErrorPageProps {
  pluginId: string;
  error: string;
}

export default function PluginLoadErrorPage({ pluginId, error }: PluginLoadErrorPageProps) {
  const { plugins, retry, forceReset } = usePluginService();
  const pluginState = plugins.get(pluginId);
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retry(pluginId);
    } finally {
      setRetrying(false);
    }
  };

  const handleReset = async () => {
    setRetrying(true);
    try {
      await forceReset(pluginId);
    } finally {
      setRetrying(false);
    }
  };

  // Show validation errors if present, otherwise fall back to generic error
  const validationErrors = pluginState?.validationErrors ?? [];
  const displayError = validationErrors.length > 0
    ? validationErrors.join('\n')
    : (pluginState?.error ?? error);

  return (
    <div className={styles.Root}>
      <LuCircleAlert size={56} className={styles.Icon} />

      <Heading level={4} as='h5' className={styles.Title}>
        Plugin failed to load
      </Heading>

      <Text as='p' size='md' tone='muted' className={styles.Subtitle}>
        The plugin <strong>{pluginId}</strong> could not be loaded.
      </Text>

      {/* Error detail box */}
      <div className={styles.ErrorBox}>
        <p className={styles.ErrorText}>{displayError}</p>
      </div>

      {/* Actions */}
      <div className={styles.Actions}>
        <Button
          variant='solid'
          color='brand'
          size='sm'
          onClick={handleRetry}
          disabled={retrying}
          startDecorator={<LuRefreshCw size={14} />}
        >
          {retrying ? 'Retrying...' : 'Retry'}
        </Button>
        <Button
          variant='soft'
          color='neutral'
          size='sm'
          onClick={handleReset}
          disabled={retrying}
          startDecorator={<LuRotateCcw size={14} />}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
