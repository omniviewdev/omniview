'use no memo';
import React, { useContext, useSyncExternalStore } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { FallbackProps } from 'react-error-boundary';

import { useExtensionPoint } from '@omniviewdev/runtime';
import type { ExtensionRenderContext, ExtensionContributionRegistration } from '@omniviewdev/runtime';

import {
  DefaultExtensionFallback,
  logPluginBoundaryError,
} from './PluginSurfaceBoundary';
import type { DefaultExtensionFallbackProps } from './PluginSurfaceBoundary';
import { QuarantinedContributionFallback } from './QuarantinedContributionFallback';
import { PluginServiceContext } from '../react/context';

// ─── Props ──────────────────────────────────────────────────────────

export interface ExtensionPointRendererProps<TContext extends ExtensionRenderContext = ExtensionRenderContext> {
  readonly extensionPointId: string;
  readonly context?: TContext;
  readonly fallback?: React.ComponentType<DefaultExtensionFallbackProps>;
  /** Extra props forwarded to each rendered component. */
  readonly componentProps?: Record<string, unknown>;
}

// ─── ContributionWrapper ────────────────────────────────────────────

/**
 * Wraps a single contribution in its own ErrorBoundary.
 * Each contribution is independently isolated — one crash does not affect siblings.
 */
function ContributionWrapper({
  registration,
  extensionPointId,
  fallback: FallbackComponent,
  context,
  componentProps,
}: {
  registration: ExtensionContributionRegistration<React.ComponentType<any>>;
  extensionPointId: string;
  fallback: React.ComponentType<DefaultExtensionFallbackProps>;
  context?: ExtensionRenderContext;
  componentProps?: Record<string, unknown>;
}): React.ReactElement {
  const Component = registration.value;
  const pluginId = registration.plugin;
  const contributionId = registration.id;

  const service = useContext(PluginServiceContext);

  const handleError = React.useCallback(
    (error: Error, info: React.ErrorInfo) => {
      logPluginBoundaryError({
        pluginId,
        boundary: 'ExtensionPointRenderer',
        extensionPointId,
        contributionId,
        message: error.message,
        stack: error.stack ?? '',
        componentStack: info.componentStack ?? '',
      });
      // F3: Record crash and check quarantine threshold
      service?.recordContributionCrash({
        contributionId,
        pluginId,
        extensionPointId,
        boundary: 'ExtensionPointRenderer',
        errorMessage: error.message,
        stack: error.stack,
        componentStack: info.componentStack ?? undefined,
        timestamp: Date.now(),
      });
    },
    [pluginId, extensionPointId, contributionId, service],
  );

  const renderFallback = React.useCallback(
    ({ error: fallbackError }: FallbackProps) => (
      <FallbackComponent
        error={fallbackError}
        pluginId={pluginId}
        extensionPointId={extensionPointId}
        contributionId={contributionId}
      />
    ),
    [pluginId, extensionPointId, contributionId, FallbackComponent],
  );

  return (
    <ErrorBoundary
      fallbackRender={renderFallback}
      onError={handleError}
      resetKeys={[registration.id]}
    >
      <Component {...(context ?? {})} {...(componentProps ?? {})} />
    </ErrorBoundary>
  );
}

// ─── ExtensionPointRenderer ─────────────────────────────────────────

/**
 * Generic component renderer for component-valued extension points.
 *
 * - Resolves matched registrations from the runtime extension registry
 * - Wraps each contribution in its own ErrorBoundary
 * - Provides a visible, local default fallback in production
 * - Emits structured boundary logs for crashes
 * - Reactively updates when registry contributions change (via useExtensionPoint)
 * - Resets error boundaries when contribution IDs change (plugin reload)
 */
export function ExtensionPointRenderer<TContext extends ExtensionRenderContext = ExtensionRenderContext>({
  extensionPointId,
  context,
  fallback = DefaultExtensionFallback,
  componentProps,
}: ExtensionPointRendererProps<TContext>): React.ReactElement | null {
  const extensionPoint = useExtensionPoint<React.ComponentType<any>, TContext>(extensionPointId);
  const registrations = extensionPoint?.list(context) ?? [];

  const service = useContext(PluginServiceContext);

  // Subscribe to service snapshot so quarantine state changes trigger re-render
  useSyncExternalStore(
    service?.subscribe.bind(service) ?? (() => () => {}),
    service?.getSnapshot.bind(service) ?? (() => null),
  );

  const isQuarantined = (contributionId: string) => service?.isQuarantined(contributionId) ?? false;
  const unquarantine = (contributionId: string) => service?.unquarantine(contributionId);

  if (registrations.length === 0) {
    return null;
  }

  return (
    <>
      {registrations.map((registration) => {
        if (isQuarantined(registration.id)) {
          if (import.meta.env.DEV) {
            return (
              <QuarantinedContributionFallback
                key={registration.id}
                pluginId={registration.plugin}
                extensionPointId={extensionPointId}
                contributionId={registration.id}
                crashCount={service?.getCrashCount(registration.id) ?? 0}
                onReEnable={() => unquarantine(registration.id)}
              />
            );
          }
          return null;
        }

        return (
          <ContributionWrapper
            key={registration.id}
            registration={registration}
            extensionPointId={extensionPointId}
            fallback={fallback}
            context={context}
            componentProps={componentProps}
          />
        );
      })}
    </>
  );
}
