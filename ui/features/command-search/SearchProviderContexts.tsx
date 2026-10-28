import { Suspense, useEffect, useMemo, type ComponentType, type ReactNode } from 'react';
import { PluginContextProvider } from '@omniviewdev/runtime';
import { ErrorBoundary } from 'react-error-boundary';
import { logPluginBoundaryError } from '../plugins/components/PluginSurfaceBoundary';
import { GLOBAL_SEARCH_EXTENSION_POINT_ID } from './extensionPoint';
import type { GlobalSearchController } from './controller';

export type SearchProviderContextRegistration = {
  key: string;
  sourceId: string;
  pluginId: string;
  Component: ComponentType;
};

function ContextReady({ controller, sourceId, children }: {
  controller: GlobalSearchController | null;
  sourceId: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!controller?.setProviderContextError(sourceId)) {
      controller?.notifyDataChanged();
    }
  }, [controller, sourceId]);
  return <>{children}</>;
}

/** Keep execution/dialog contexts alive outside the palette, with one runtime context per plugin. */
export function SearchProviderContexts({ contexts, controller }: {
  contexts: readonly SearchProviderContextRegistration[];
  controller: GlobalSearchController | null;
}) {
  const groups = useMemo(() => {
    const result = new Map<string, SearchProviderContextRegistration[]>();
    for (const context of contexts) {
      const group = result.get(context.pluginId) ?? [];
      group.push(context);
      result.set(context.pluginId, group);
    }

    return result;
  }, [contexts]);

  function failed(entries: readonly SearchProviderContextRegistration[], error: Error) {
    for (const entry of entries) {
      controller?.setProviderContextError(entry.sourceId, 'Search action context failed. Reload this plugin to recover.');
      logPluginBoundaryError({
        pluginId: entry.pluginId,
        boundary: 'ExtensionPointRenderer',
        extensionPointId: GLOBAL_SEARCH_EXTENSION_POINT_ID,
        contributionId: entry.sourceId,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  return <>{Array.from(groups, ([pluginId, entries]) => {
    const children = entries.map(({ Component, ...entry }) => (
      <ErrorBoundary key={entry.key} fallback={null} onError={(error) => {
        failed([{ ...entry, Component }], error); 
      }}>
        <Suspense fallback={null}>
          <ContextReady controller={controller} sourceId={entry.sourceId}>
            <Component />
          </ContextReady>
        </Suspense>
      </ErrorBoundary>
    ));
    return (
      <ErrorBoundary key={pluginId} resetKeys={entries.map(entry => entry.key)} fallback={null}
        onError={(error) => {
          failed(entries, error); 
        }}>
        {pluginId === 'core' ? children : (
          <PluginContextProvider pluginId={pluginId} headless>{children}</PluginContextProvider>
        )}
      </ErrorBoundary>
    );
  })}</>;
}
