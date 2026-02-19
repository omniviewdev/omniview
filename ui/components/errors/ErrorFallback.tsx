import React from 'react';
import type { FallbackProps } from 'react-error-boundary';
import Box from '@mui/joy/Box';
import Card from '@mui/joy/Card';
import Typography from '@mui/joy/Typography';
import Button from '@mui/joy/Button';
import Divider from '@mui/joy/Divider';
import Stack from '@mui/joy/Stack';
import Chip from '@mui/joy/Chip';
import Tooltip from '@mui/joy/Tooltip';
import { LuCircleAlert, LuCopy, LuRefreshCw, LuRotateCcw, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import log from '@/features/logger';
import { isDev } from '@/utils/env';
import { generateErrorId } from '@/utils/errorId';

// ─── Error Metadata ──────────────────────────────────────────────────────────

export type ErrorMeta = {
  errorId: string;
  timestamp: string;
  boundary?: string;
};

export function createErrorMeta(boundary?: string): ErrorMeta {
  return {
    errorId: generateErrorId(),
    timestamp: new Date().toISOString(),
    ...(boundary ? { boundary } : {}),
  };
}

// ─── Shared onError handler ─────────────────────────────────────────────────

export function onBoundaryError(error: Error, info: { componentStack?: string | null }, meta?: ErrorMeta) {
  log.error(error, {
    componentStack: info.componentStack ?? 'unavailable',
    ...(meta ? { errorId: meta.errorId, boundary: meta.boundary } : {}),
  });
}

// ─── FullPageErrorFallback ──────────────────────────────────────────────────

type FullPageErrorFallbackProps = FallbackProps & {
  boundary?: string;
};

export function FullPageErrorFallback({ error, resetErrorBoundary, boundary }: FullPageErrorFallbackProps) {
  const [showStack, setShowStack] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const meta = React.useMemo(() => createErrorMeta(boundary), [error]);
  const dev = isDev();

  const copyError = () => {
    const text = `Error ID: ${meta.errorId}\n${error.message}\n\n${error.stack ?? ''}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100%',
        flex: 1,
        p: 4,
        bgcolor: 'background.body',
      }}
    >
      <Card
        variant="outlined"
        sx={{
          maxWidth: 600,
          width: '100%',
          borderColor: 'danger.outlinedBorder',
          bgcolor: 'background.surface',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <LuCircleAlert size={22} color="var(--joy-palette-danger-500)" />
          <Typography level="title-lg">Something went wrong</Typography>
          <Chip variant="soft" color="danger" size="sm">{error.name}</Chip>
        </Stack>

        <Typography level="body-sm" sx={{ color: 'danger.plainColor', mt: 1 }}>
          {dev ? error.message : `An unexpected error occurred: ${error.message}`}
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <Chip variant="outlined" color="neutral" size="sm">{meta.errorId}</Chip>
          <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>{meta.timestamp}</Typography>
          {dev && meta.boundary && (
            <Chip variant="soft" color="neutral" size="sm">Caught by: {meta.boundary}</Chip>
          )}
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        {dev && (
          <>
            <Button
              variant="plain"
              color="neutral"
              size="sm"
              startDecorator={showStack ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
              onClick={() => setShowStack(!showStack)}
              sx={{ alignSelf: 'flex-start', px: 0.5 }}
            >
              Stack Trace
            </Button>

            {showStack && (
              <Box
                component="pre"
                sx={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'text.secondary',
                  bgcolor: 'background.level1',
                  borderRadius: 'sm',
                  p: 1.5,
                  maxHeight: 300,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  m: 0,
                }}
              >
                {error.stack ?? 'No stack trace available'}
              </Box>
            )}
          </>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button
            variant="solid"
            color="danger"
            size="sm"
            startDecorator={<LuRotateCcw size={14} />}
            onClick={resetErrorBoundary}
          >
            Try Again
          </Button>
          <Button
            variant="outlined"
            color="neutral"
            size="sm"
            startDecorator={<LuRefreshCw size={14} />}
            onClick={() => window.location.reload()}
          >
            Reload Application
          </Button>
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            startDecorator={<LuCopy size={14} />}
            onClick={copyError}
          >
            {copied ? 'Copied!' : 'Copy Error'}
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}

// ─── PanelErrorFallback ─────────────────────────────────────────────────────

type PanelErrorFallbackProps = FallbackProps & {
  label?: string;
  boundary?: string;
};

export function PanelErrorFallback({ error, resetErrorBoundary, label, boundary }: PanelErrorFallbackProps) {
  const [showStack, setShowStack] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const meta = React.useMemo(() => createErrorMeta(boundary), [error]);
  const dev = isDev();

  const copyError = () => {
    const text = `Error ID: ${meta.errorId}\n${error.message}\n\n${error.stack ?? ''}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const title = label
    ? (dev ? `${label} crashed` : `${label} encountered an error`)
    : (dev ? 'Component crashed' : 'Component encountered an error');

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}
    >
      <Card
        variant="outlined"
        sx={{
          maxWidth: 480,
          width: '100%',
          borderColor: 'danger.outlinedBorder',
          bgcolor: 'background.surface',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <LuCircleAlert size={18} color="var(--joy-palette-danger-500)" />
          <Typography level="title-sm">{title}</Typography>
          <Chip variant="soft" color="danger" size="sm">{error.name}</Chip>
        </Stack>

        <Typography level="body-xs" sx={{ color: 'danger.plainColor', mt: 0.5 }}>
          {error.message}
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
          <Chip variant="outlined" color="neutral" size="sm">{meta.errorId}</Chip>
          <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>{meta.timestamp}</Typography>
        </Stack>

        {dev && (
          <>
            <Divider sx={{ my: 1 }} />
            <Button
              variant="plain"
              color="neutral"
              size="sm"
              startDecorator={showStack ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
              onClick={() => setShowStack(!showStack)}
              sx={{ alignSelf: 'flex-start', px: 0.5 }}
            >
              Stack Trace
            </Button>
            {showStack && (
              <Box
                component="pre"
                sx={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'text.secondary',
                  bgcolor: 'background.level1',
                  borderRadius: 'sm',
                  p: 1,
                  maxHeight: 200,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  m: 0,
                }}
              >
                {error.stack ?? 'No stack trace available'}
              </Box>
            )}
          </>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Button
            variant="solid"
            color="danger"
            size="sm"
            startDecorator={<LuRotateCcw size={14} />}
            onClick={resetErrorBoundary}
          >
            Retry
          </Button>
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            startDecorator={<LuCopy size={14} />}
            onClick={copyError}
          >
            {copied ? 'Copied!' : 'Copy Error'}
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}

// ─── InlineErrorFallback ────────────────────────────────────────────────────

type InlineErrorFallbackProps = FallbackProps & {
  label?: string;
};

export function InlineErrorFallback({ error, resetErrorBoundary, label }: InlineErrorFallbackProps) {
  const meta = React.useMemo(() => createErrorMeta(), [error]);

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1 }}>
      <Tooltip title={meta.errorId} placement="top" arrow>
        <span style={{ display: 'inline-flex' }}>
          <LuCircleAlert size={14} color="var(--joy-palette-danger-500)" />
        </span>
      </Tooltip>
      <Typography level="body-sm" color="danger">
        Failed to render {label ?? 'component'}
      </Typography>
      <Chip
        variant="soft"
        color="danger"
        size="sm"
        onClick={resetErrorBoundary}
        sx={{ cursor: 'pointer' }}
      >
        Retry
      </Chip>
    </Stack>
  );
}

// ─── Unstyled Root Fallback (outside MUI providers) ─────────────────────────

export function RootErrorFallback({ error }: { error: Error }) {
  const meta = React.useMemo(() => createErrorMeta(), [error]);
  const dev = isDev();

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#0E0E10',
        color: '#E4E4E7',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 560, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: 18, fontWeight: 600 }}>Application Error</span>
        </div>
        <p style={{ color: '#F87171', margin: '0 0 8px', fontSize: 14 }}>
          {error.message}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <code style={{ fontSize: 12, color: '#A1A1AA', background: '#18181B', padding: '2px 8px', borderRadius: 4 }}>
            {meta.errorId}
          </code>
          <span style={{ fontSize: 11, color: '#71717A' }}>{meta.timestamp}</span>
        </div>
        {dev && error.stack && (
          <pre
            style={{
              fontSize: 11,
              color: '#A1A1AA',
              backgroundColor: '#18181B',
              borderRadius: 6,
              border: '1px solid #27272A',
              padding: 12,
              maxHeight: 300,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              margin: '0 0 16px',
            }}
          >
            {error.stack}
          </pre>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#EF4444',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Reload Application
        </button>
      </div>
    </div>
  );
}
