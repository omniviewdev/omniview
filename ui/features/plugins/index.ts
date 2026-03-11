// Feature barrel — host consumers import only from here.

export { PluginServiceProvider } from './react/PluginServiceProvider';
export { usePluginService } from './react/usePluginService';
export { usePluginRoutes } from './react/usePluginRoutes';
export { ExtensionPointRenderer } from './components/ExtensionPointRenderer';
export { PluginSurfaceBoundary } from './components/PluginSurfaceBoundary';
export {
  logPluginBoundaryError,
  DefaultExtensionFallback,
  DefaultPluginFallback,
} from './components/PluginSurfaceBoundary';

export type {
  PluginPhase,
  PluginState,
  PluginServiceSnapshot,
  PluginServiceConfig,
  PluginServiceDebugSnapshot,
  ResourceExtensionRenderContext,
} from './core/types';

export type {
  ExtensionPointRendererProps,
} from './components/ExtensionPointRenderer';
export type {
  PluginSurfaceBoundaryProps,
  PluginBoundaryLogEvent,
  DefaultExtensionFallbackProps,
  DefaultPluginFallbackProps,
} from './components/PluginSurfaceBoundary';
