import type { ResourceExtensionRenderContext } from '@/features/plugins/core/types';

/**
 * Create a structured render context for resource extension point lookups.
 *
 * Uses structured { pluginId, resourceKey } — no flattened string parsing.
 * getCacheKey() produces deterministic JSON for store-level cache hits.
 */
export function createResourceExtensionRenderContext(
  pluginId: string,
  resourceKey: string,
): ResourceExtensionRenderContext {
  return {
    pluginId,
    resourceKey,
    getCacheKey: () => JSON.stringify({ pluginId, resourceKey }),
  };
}
