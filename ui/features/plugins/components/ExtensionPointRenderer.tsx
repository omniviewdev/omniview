import React, { useContext, useSyncExternalStore } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { FallbackProps } from 'react-error-boundary';

import { useExtensionRegistry } from '@omniviewdev/runtime';
import type { ExtensionRenderContext, ExtensionContributionRegistration, ExtensionPointRegistryContract, ExtensionPointStoreContract } from '@omniviewdev/runtime';
import type { PluginService } from '../core/PluginService';
import type { PluginServiceSnapshot } from '../core/types';

import {
  DefaultExtensionFallback,
  logPluginBoundaryError,
} from './PluginSurfaceBoundary';
import type { DefaultExtensionFallbackProps } from './PluginSurfaceBoundary';
import { QuarantinedContributionFallback } from './QuarantinedContributionFallback';
import { PluginServiceContext } from '../react/context';

// ─── Props ──────────────────────────────────────────────────────────

export type ExtensionPointRendererProps<TContext extends ExtensionRenderContext = ExtensionRenderContext> = {
  readonly extensionPointId: string;
  readonly context?: TContext;
  readonly fallback?: React.ComponentType<DefaultExtensionFallbackProps>;
  /** Extra props forwarded to each rendered component. */
  readonly componentProps?: Record<string, unknown>;
};

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
    (caught: unknown, info: React.ErrorInfo) => {
      const error = caught instanceof Error ? caught : new Error(String(caught));
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
        error={fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError))}
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

function createContributionStore<TContext extends ExtensionRenderContext>(
  registry: ExtensionPointRegistryContract | undefined,
  service: PluginService | null,
  extensionPointId: string,
  context: TContext | undefined,
) {
  type Registration = ExtensionContributionRegistration<React.ComponentType<any>>;
  let point: ExtensionPointStoreContract<React.ComponentType<any>, TContext> | undefined;
  let version = -1;
  let serviceVersion: PluginServiceSnapshot | undefined;
  let snapshot: Array<{ registration: Registration; quarantined: boolean; crashCount: number }> = [];

  return {
    subscribe: (notify: () => void) => {
      const stopRegistry = registry?.subscribe(notify);
      const stopService = service?.subscribe(notify);
      return () => {
        stopRegistry?.();
        stopService?.();
      };
    },
    getSnapshot: () => {
      const current = registry?.getExtensionPoint<React.ComponentType<any>, TContext>(extensionPointId);
      const currentVersion = current?.version ?? -1;
      const currentServiceVersion = service?.getSnapshot();
      if (current !== point || currentVersion !== version || currentServiceVersion !== serviceVersion) {
        point = current;
        version = currentVersion;
        serviceVersion = currentServiceVersion;
        snapshot = (current?.list(context) ?? []).map(registration => ({
          registration,
          quarantined: service?.isQuarantined(registration.id) ?? false,
          crashCount: service?.getCrashCount(registration.id) ?? 0,
        }));
      }

      return snapshot;
    },
  };
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
  const registry = useExtensionRegistry();
  const service = useContext(PluginServiceContext);
  const store = React.useMemo(
    () => createContributionStore(registry, service, extensionPointId, context),
    [registry, service, extensionPointId, context],
  );
  const registrations = useSyncExternalStore(store.subscribe, store.getSnapshot);

  if (registrations.length === 0) {
    return null;
  }

  return (
    <>
      {registrations.map(({ registration, quarantined, crashCount }) => {
        if (quarantined) {
          if (import.meta.env.DEV) {
            return (
              <QuarantinedContributionFallback
                key={registration.id}
                pluginId={registration.plugin}
                extensionPointId={extensionPointId}
                contributionId={registration.id}
                crashCount={crashCount}
                onReEnable={() => service?.unquarantine(registration.id)}
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
