import { useContext } from 'react';
import { PluginContext } from '../context/plugins/PluginContext';

/**
 * Resolves the pluginID to use for API calls and event subscriptions.
 *
 * Prefers the pluginID from PluginContext (set by the framework when a
 * plugin is mounted). Falls back to an explicit value when no context is
 * available (e.g. host-app code calling a hook directly).
 */
export function useResolvedPluginId(explicit?: string): string {
  const ctx = useContext(PluginContext);
  const resolved = ctx?.pluginId ?? explicit;
  if (!resolved) {
    throw new Error(
      'pluginID must be provided either via PluginContext or as an explicit parameter',
    );
  }
  return resolved;
}
