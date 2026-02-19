import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

import Button from '../buttons/Button';
import CopyButton from '../buttons/CopyButton';

export interface ErrorStateProps {
  message: string;
  errorId?: string;
  onRetry?: () => void;
  onCopyError?: () => void;
  variant?: 'page' | 'panel' | 'inline';
}

export default function ErrorState({
  message,
  errorId,
  onRetry,
  variant = 'panel',
}: ErrorStateProps) {
  const isInline = variant === 'inline';
  const isPage = variant === 'page';

  const iconSize = isPage ? 56 : isInline ? 20 : 40;

  if (isInline) {
    return (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          color: 'var(--ov-danger-default)',
        }}
      >
        <ErrorOutlineIcon sx={{ fontSize: iconSize }} />
        <Typography variant="body2" sx={{ color: 'var(--ov-danger-default)' }}>
          {message}
        </Typography>
        {onRetry && (
          <Button size="xs" emphasis="ghost" color="danger" onClick={onRetry}>
            Retry
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: isPage ? 8 : 4,
        px: 2,
        ...(isPage && { minHeight: '60vh' }),
      }}
    >
      <ErrorOutlineIcon
        sx={{
          fontSize: iconSize,
          color: 'var(--ov-danger-default)',
          mb: 2,
        }}
      />

      <Typography
        variant={isPage ? 'h5' : 'subtitle1'}
        sx={{ color: 'var(--ov-fg-default)', fontWeight: 600, mb: 0.5 }}
      >
        Something went wrong
      </Typography>

      <Typography
        variant="body2"
        sx={{
          color: 'var(--ov-fg-muted)',
          maxWidth: 420,
          lineHeight: 1.5,
          mb: 1,
        }}
      >
        {message}
      </Typography>

      {errorId && (
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            mb: 2,
            px: 1.5,
            py: 0.5,
            borderRadius: '4px',
            bgcolor: 'var(--ov-bg-surface-inset)',
          }}
        >
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'var(--ov-font-mono)',
              color: 'var(--ov-fg-muted)',
              fontSize: 'var(--ov-text-xs)',
            }}
          >
            Error ID: {errorId}
          </Typography>
          <CopyButton value={errorId} size="xs" />
        </Box>
      )}

      {onRetry && (
        <Button emphasis="outline" color="primary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Box>
  );
}

ErrorState.displayName = 'ErrorState';
