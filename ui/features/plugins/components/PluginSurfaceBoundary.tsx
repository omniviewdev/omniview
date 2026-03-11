import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { FallbackProps } from 'react-error-boundary';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

// ─── Boundary Log Event ─────────────────────────────────────────────

export interface PluginBoundaryLogEvent {
  readonly pluginId: string;
  readonly boundary: string;
  readonly extensionPointId?: string;
  readonly contributionId?: string;
  readonly resourceKey?: string;
  readonly message: string;
  readonly stack?: string;
  readonly componentStack?: string;
}

/**
 * Emit a structured log for any plugin boundary crash.
 * All boundary logs go through this single helper for consistency.
 */
export function logPluginBoundaryError(event: PluginBoundaryLogEvent): void {
  const context: Record<string, unknown> = {
    pluginId: event.pluginId,
    boundary: event.boundary,
  };
  if (event.extensionPointId) context.extensionPointId = event.extensionPointId;
  if (event.contributionId) context.contributionId = event.contributionId;
  if (event.resourceKey) context.resourceKey = event.resourceKey;
  if (event.stack) context.stack = event.stack;
  if (event.componentStack) context.componentStack = event.componentStack;

  // Use console.error for boundary crashes — this is the host's boundary logger,
  // not the service's structured logger (which operates on service lifecycle events).
  // eslint-disable-next-line no-console
  console.error(`[PluginBoundary] ${event.boundary} crash — plugin "${event.pluginId}": ${event.message}`, context);
}

// ─── Default Fallback Components ────────────────────────────────────

export interface DefaultExtensionFallbackProps {
  readonly error: Error;
  readonly pluginId: string;
  readonly extensionPointId: string;
  readonly contributionId: string;
}

/**
 * Default fallback for extension point contribution crashes.
 * Visible in production for plugin-owned IDE surfaces — never collapses to null.
 */
export function DefaultExtensionFallback({
  error,
  pluginId,
  extensionPointId,
  contributionId,
}: DefaultExtensionFallbackProps): React.ReactElement {
  return (
    <Box
      role="alert"
      sx={{
        p: 1.5,
        border: '1px solid',
        borderColor: 'error.main',
        borderRadius: 1,
        bgcolor: 'error.light',
      }}
    >
      <Typography variant="caption" color="error.main" fontWeight="bold">
        Extension Error
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Plugin: {pluginId}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Extension Point: {extensionPointId}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Contribution: {contributionId}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
        {error.message}
      </Typography>
    </Box>
  );
}

export interface DefaultPluginFallbackProps {
  readonly error: Error;
  readonly pluginId: string;
  readonly boundary: string;
  readonly resourceKey?: string;
}

/**
 * Default fallback for plugin surface crashes (drawer, modal, route).
 * Visible in production — never collapses to null.
 */
export function DefaultPluginFallback({
  error,
  pluginId,
  boundary,
  resourceKey,
}: DefaultPluginFallbackProps): React.ReactElement {
  return (
    <Box
      role="alert"
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'error.main',
        borderRadius: 1,
        bgcolor: 'error.light',
      }}
    >
      <Typography variant="subtitle2" color="error.main" fontWeight="bold">
        Plugin Error
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Plugin: {pluginId}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Surface: {boundary}
      </Typography>
      {resourceKey && (
        <Typography variant="body2" color="text.secondary">
          Resource: {resourceKey}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {error.message}
      </Typography>
    </Box>
  );
}

// ─── PluginSurfaceBoundary ──────────────────────────────────────────

export interface PluginSurfaceBoundaryProps {
  readonly pluginId: string;
  readonly boundary: 'plugin-route' | 'drawer-surface' | 'modal-surface';
  readonly resourceKey?: string;
  readonly children: React.ReactNode;
  readonly fallback?: React.ComponentType<DefaultPluginFallbackProps>;
  /** Optional reset keys — boundary resets when these change (e.g., loadedAt). */
  readonly resetKeys?: unknown[];
}

/**
 * Local error boundary for non-extension-point plugin surfaces.
 *
 * Wraps drawer, modal, or plugin-route content so that plugin crashes
 * are contained locally — the shell/chrome of the containing surface
 * remains intact.
 *
 * Emits structured boundary logs with pluginId, boundary, and resourceKey.
 */
export function PluginSurfaceBoundary({
  pluginId,
  boundary,
  resourceKey,
  children,
  fallback: FallbackComponent = DefaultPluginFallback,
  resetKeys,
}: PluginSurfaceBoundaryProps): React.ReactElement {
  const handleError = React.useCallback(
    (error: Error, info: React.ErrorInfo) => {
      logPluginBoundaryError({
        pluginId,
        boundary,
        resourceKey,
        message: error.message,
        stack: error.stack ?? '',
        componentStack: info.componentStack ?? '',
      });
    },
    [pluginId, boundary, resourceKey],
  );

  const renderFallback = React.useCallback(
    ({ error: fallbackError }: FallbackProps) => (
      <FallbackComponent
        error={fallbackError}
        pluginId={pluginId}
        boundary={boundary}
        resourceKey={resourceKey}
      />
    ),
    [pluginId, boundary, resourceKey, FallbackComponent],
  );

  const effectiveResetKeys = [pluginId, boundary, resourceKey, ...(resetKeys ?? [])];

  return (
    <ErrorBoundary
      fallbackRender={renderFallback}
      onError={handleError}
      resetKeys={effectiveResetKeys}
    >
      {children}
    </ErrorBoundary>
  );
}
