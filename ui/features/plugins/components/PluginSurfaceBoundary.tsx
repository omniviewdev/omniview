import React, { useContext } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { FallbackProps } from 'react-error-boundary';
import { useRouteError } from 'react-router';
import { Text } from '@omniviewdev/base-ui';
import { PluginServiceContext } from '../react/context';
import styles from './PluginSurfaceBoundary.module.css';

// ─── Boundary Log Event ─────────────────────────────────────────────

export type BoundaryKind = 'plugin-route' | 'drawer-surface' | 'modal-surface' | 'ExtensionPointRenderer' | 'resource-cell';

export type PluginBoundaryLogEvent = {
  readonly pluginId: string;
  readonly boundary: BoundaryKind;
  readonly extensionPointId?: string;
  readonly contributionId?: string;
  readonly resourceKey?: string;
  readonly message: string;
  readonly stack?: string;
  readonly componentStack?: string;
};

/**
 * Emit a structured log for any plugin boundary crash.
 * All boundary logs go through this single helper for consistency.
 */
export function logPluginBoundaryError(event: PluginBoundaryLogEvent): void {
  const context: Record<string, unknown> = {
    pluginId: event.pluginId,
    boundary: event.boundary,
  };
  if (event.extensionPointId !== undefined) {
    context.extensionPointId = event.extensionPointId;
  }

  if (event.contributionId !== undefined) {
    context.contributionId = event.contributionId;
  }

  if (event.resourceKey !== undefined) {
    context.resourceKey = event.resourceKey;
  }

  if (event.stack !== undefined) {
    context.stack = event.stack;
  }

  if (event.componentStack !== undefined) {
    context.componentStack = event.componentStack;
  }

  // Use console.error for boundary crashes — this is the host's boundary logger,
  // not the service's structured logger (which operates on service lifecycle events).
  console.error(`[PluginBoundary] ${event.boundary} crash — plugin "${event.pluginId}": ${event.message}`, context);
}

// ─── Default Fallback Components ────────────────────────────────────

export type DefaultExtensionFallbackProps = {
  readonly error: Error;
  readonly pluginId: string;
  readonly extensionPointId: string;
  readonly contributionId: string;
};

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
    <div role="alert" className={styles.ExtensionRoot}>
      <Text size="xs" tone="danger" weight="semibold">
        Extension Error
      </Text>
      <Text size="xs" tone="muted" className={styles.Line}>
        Plugin: {pluginId}
      </Text>
      <Text size="xs" tone="muted" className={styles.Line}>
        Extension Point: {extensionPointId}
      </Text>
      <Text size="xs" tone="muted" className={styles.Line}>
        Contribution: {contributionId}
      </Text>
      <Text size="xs" tone="muted" className={styles.Message}>
        {error.message}
      </Text>
    </div>
  );
}

export type DefaultPluginFallbackProps = {
  readonly error: Error;
  readonly pluginId: string;
  readonly boundary: BoundaryKind;
  readonly resourceKey?: string;
};

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
    <div role="alert" className={styles.PluginRoot}>
      <Text size="sm" tone="danger" weight="semibold" className={styles.Line}>
        Plugin Error
      </Text>
      <Text size="sm" tone="muted" className={styles.Line}>
        Plugin: {pluginId}
      </Text>
      <Text size="sm" tone="muted" className={styles.Line}>
        Surface: {boundary}
      </Text>
      {resourceKey && (
        <Text size="sm" tone="muted" className={styles.Line}>
          Resource: {resourceKey}
        </Text>
      )}
      <Text size="sm" tone="muted" className={styles.MessageLarge}>
        {error.message}
      </Text>
    </div>
  );
}

// ─── PluginSurfaceBoundary ──────────────────────────────────────────

export type PluginSurfaceBoundaryProps = {
  readonly pluginId: string;
  readonly boundary: BoundaryKind;
  readonly resourceKey?: string;
  readonly children: React.ReactNode;
  readonly fallback?: React.ComponentType<DefaultPluginFallbackProps>;
  /** Optional reset keys — boundary resets when these change (e.g., loadedAt). */
  readonly resetKeys?: unknown[];
};

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
  const handleError = usePluginBoundaryError(pluginId, boundary, resourceKey);

  const renderFallback = React.useCallback(
    ({ error: fallbackError }: FallbackProps) => (
      <FallbackComponent
        error={fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError))}
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

/** Adapt router render/loader failures to the same local plugin crash reporting. */
export function PluginRouteErrorBoundary({ pluginId }: { readonly pluginId: string }): React.ReactElement {
  const caught = useRouteError();
  const error = React.useMemo(
    () => caught instanceof Error ? caught : new Error(String(caught)),
    [caught],
  );
  const reportError = usePluginBoundaryError(pluginId, 'plugin-route');
  React.useEffect(() => {
    reportError(error, {});
  }, [error, reportError]);
  return <DefaultPluginFallback pluginId={pluginId} boundary="plugin-route" error={error} />;
}

function usePluginBoundaryError(pluginId: string, boundary: BoundaryKind, resourceKey?: string) {
  const service = useContext(PluginServiceContext);
  return React.useCallback(
    (caught: unknown, info: React.ErrorInfo) => {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      logPluginBoundaryError({
        pluginId,
        boundary,
        resourceKey,
        message: error.message,
        stack: error.stack ?? '',
        componentStack: info.componentStack ?? '',
      });
      // Quarantine applies only to extension contributions, not whole routes.
      service?.recordBoundaryCrash({
        contributionId: `${pluginId}/${boundary}${resourceKey ? `/${resourceKey}` : ''}`,
        pluginId,
        extensionPointId: '',
        boundary,
        resourceKey,
        errorMessage: error.message,
        stack: error.stack,
        componentStack: info.componentStack ?? undefined,
        timestamp: Date.now(),
      });
    },
    [pluginId, boundary, resourceKey, service],
  );
}
