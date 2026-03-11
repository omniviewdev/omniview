// Feature barrel — host consumers import only from here.

export { PluginServiceProvider } from './react/PluginServiceProvider';
export { usePluginService } from './react/usePluginService';
export { usePluginRoutes } from './react/usePluginRoutes';
export { ExtensionPointRenderer } from './components/ExtensionPointRenderer';
export { QuarantinedContributionFallback } from './components/QuarantinedContributionFallback';
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
  DeclaredDependencies,
  CrashRecord,
  CrashDataStrategy,
  QuarantineInfo,
  DependencyGraph,
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
export type {
  QuarantinedContributionFallbackProps,
} from './components/QuarantinedContributionFallback';
