import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { LuRefreshCw } from 'react-icons/lu';
import { usePluginRegistry } from '../usePluginRegistry';

interface PluginLoadErrorPageProps {
  pluginId: string;
  error: string;
}

export default function PluginLoadErrorPage({ pluginId, error }: PluginLoadErrorPageProps) {
  const { retryPlugin } = usePluginRegistry();
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retryPlugin(pluginId);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight: '60vh',
        py: 8,
        px: 3,
      }}
    >
      <ErrorOutlineIcon
        sx={{
          fontSize: 56,
          color: 'var(--ov-danger-default)',
          mb: 2,
        }}
      />

      <Typography
        variant="h5"
        sx={{ color: 'var(--ov-fg-default)', fontWeight: 600, mb: 0.5 }}
      >
        Plugin failed to load
      </Typography>

      <Typography
        variant="body1"
        sx={{
          color: 'var(--ov-fg-muted)',
          mb: 2,
        }}
      >
        The plugin <strong>{pluginId}</strong> could not be loaded.
      </Typography>

      {/* Error detail box */}
      <Box
        sx={{
          maxWidth: 560,
          width: '100%',
          mb: 3,
          p: 1.5,
          borderRadius: '6px',
          bgcolor: 'rgba(248,81,73,0.08)',
          border: '1px solid rgba(248,81,73,0.2)',
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontFamily: 'var(--ov-font-mono, monospace)',
            fontSize: '0.75rem',
            color: '#f85149',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            textAlign: 'left',
          }}
        >
          {error}
        </Typography>
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <Box
          component="button"
          onClick={handleRetry}
          disabled={retrying}
          sx={{
            all: 'unset',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            px: 2,
            py: 1,
            fontSize: '0.8125rem',
            fontWeight: 500,
            fontFamily: 'var(--ov-font-ui)',
            color: '#fff',
            bgcolor: 'var(--ov-accent-default)',
            borderRadius: '6px',
            cursor: retrying ? 'wait' : 'pointer',
            opacity: retrying ? 0.7 : 1,
            '&:hover': retrying ? {} : { filter: 'brightness(1.1)' },
          }}
        >
          <LuRefreshCw size={14} />
          {retrying ? 'Retrying...' : 'Retry'}
        </Box>
      </Box>
    </Box>
  );
}
