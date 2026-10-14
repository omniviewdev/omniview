import React from 'react';
import type { FallbackProps } from 'react-error-boundary';
import { Button, Card, Chip, Separator, Stack, Text } from '@omniviewdev/base-ui';
import { LuCircleAlert, LuCopy, LuRefreshCw, LuRotateCcw, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import log from '@/features/logger';
import { isDev } from '@/utils/env';
import { generateErrorId } from '@/utils/errorId';
import HintTooltip from '@/components/base/HintTooltip';
import styles from './ErrorFallback.module.css';

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
      setTimeout(() => {
        setCopied(false); 
      }, 2000);
    });
  };

  return (
    <div className={styles.FullPageRoot}>
      <Card variant="outline" className={`${styles.Card} ${styles.FullPageCard}`}>
        <Stack direction="row" spacing={3} align="center">
          <LuCircleAlert size={22} className={styles.DangerIcon} />
          <Text weight="semibold" size="lg">Something went wrong</Text>
          <Chip variant="soft" color="danger" size="sm">{error.name}</Chip>
        </Stack>

        <Text size="sm" tone="danger" className={styles.FullPageMessage}>
          {dev ? error.message : `An unexpected error occurred: ${error.message}`}
        </Text>

        <Stack direction="row" spacing={2} align="center" className={styles.MetaRow}>
          <Chip variant="outline" color="neutral" size="sm">{meta.errorId}</Chip>
          <Text size="xs" tone="subtle">{meta.timestamp}</Text>
          {dev && meta.boundary && (
            <Chip variant="soft" color="neutral" size="sm">{`Caught by: ${meta.boundary}`}</Chip>
          )}
        </Stack>

        <Separator className={styles.FullPageSeparator} />

        {dev && (
          <>
            <Button
              variant="ghost"
              color="neutral"
              size="sm"
              startDecorator={showStack ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
              onClick={() => {
                setShowStack(!showStack);
              }}
              className={styles.StackToggle}
            >
              Stack Trace
            </Button>

            {showStack && (
              <pre className={styles.Stack}>
                {error.stack ?? 'No stack trace available'}
              </pre>
            )}
          </>
        )}

        <Stack direction="row" spacing={2} className={styles.FullPageActions}>
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
            variant="outline"
            color="neutral"
            size="sm"
            startDecorator={<LuRefreshCw size={14} />}
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload Application
          </Button>
          <Button
            variant="ghost"
            color="neutral"
            size="sm"
            startDecorator={<LuCopy size={14} />}
            onClick={copyError}
          >
            {copied ? 'Copied!' : 'Copy Error'}
          </Button>
        </Stack>
      </Card>
    </div>
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
      setTimeout(() => {
        setCopied(false); 
      }, 2000);
    });
  };

  const title = label
    ? (dev ? `${label} crashed` : `${label} encountered an error`)
    : (dev ? 'Component crashed' : 'Component encountered an error');

  return (
    <div className={styles.PanelRoot}>
      <Card variant="outline" className={`${styles.Card} ${styles.PanelCard}`}>
        <Stack direction="row" spacing={2} align="center">
          <LuCircleAlert size={18} className={styles.DangerIcon} />
          <Text weight="semibold" size="sm">{title}</Text>
          <Chip variant="soft" color="danger" size="sm">{error.name}</Chip>
        </Stack>

        <Text size="xs" tone="danger" className={styles.PanelMessage}>
          {error.message}
        </Text>

        <Stack direction="row" spacing={2} align="center" className={styles.PanelMetaRow}>
          <Chip variant="outline" color="neutral" size="sm">{meta.errorId}</Chip>
          <Text size="xs" tone="subtle">{meta.timestamp}</Text>
        </Stack>

        {dev && (
          <>
            <Separator className={styles.PanelSeparator} />
            <Button
              variant="ghost"
              color="neutral"
              size="sm"
              startDecorator={showStack ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
              onClick={() => {
                setShowStack(!showStack);
              }}
              className={styles.StackToggle}
            >
              Stack Trace
            </Button>
            {showStack && (
              <pre className={`${styles.Stack} ${styles.PanelStack}`}>
                {error.stack ?? 'No stack trace available'}
              </pre>
            )}
          </>
        )}

        <Stack direction="row" spacing={2} className={styles.PanelActions}>
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
            variant="ghost"
            color="neutral"
            size="sm"
            startDecorator={<LuCopy size={14} />}
            onClick={copyError}
          >
            {copied ? 'Copied!' : 'Copy Error'}
          </Button>
        </Stack>
      </Card>
    </div>
  );
}

// ─── InlineErrorFallback ────────────────────────────────────────────────────

type InlineErrorFallbackProps = FallbackProps & {
  label?: string;
};

export function InlineErrorFallback({ error, resetErrorBoundary, label }: InlineErrorFallbackProps) {
  const meta = React.useMemo(() => createErrorMeta(), [error]);

  return (
    <Stack direction="row" spacing={2} align="center" className={styles.InlineRoot}>
      <HintTooltip content={meta.errorId} side="top">
        <span className={styles.InlineIconWrap}>
          <LuCircleAlert size={14} className={styles.DangerIcon} />
        </span>
      </HintTooltip>
      <Text size="sm" tone="danger">
        Failed to render {label ?? 'component'}
      </Text>
      <Chip
        variant="soft"
        color="danger"
        size="sm"
        clickable
        onClick={resetErrorBoundary}
      >
        Retry
      </Chip>
    </Stack>
  );
}

// ─── Unstyled Root Fallback (outside theme providers) ─────────────────────────

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
        backgroundColor: '#0D1117',
        color: '#ECF0F6',
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
          <code style={{ fontSize: 12, color: '#8B9BB5', background: '#151B23', padding: '2px 8px', borderRadius: 4 }}>
            {meta.errorId}
          </code>
          <span style={{ fontSize: 11, color: '#6B7D96' }}>{meta.timestamp}</span>
        </div>
        {dev && error.stack && (
          <pre
            style={{
              fontSize: 11,
              color: '#8B9BB5',
              backgroundColor: '#151B23',
              borderRadius: 6,
              border: '1px solid #3E4F66',
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
          onClick={() => {
            window.location.reload(); 
          }}
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
