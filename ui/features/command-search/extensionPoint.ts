import type { ExtensionPointSettings, ExtensionRenderContext } from '@omniviewdev/runtime';
import type { GlobalSearchContributionV1 } from './types';

export const GLOBAL_SEARCH_EXTENSION_POINT_ID = 'omniview/global-search';

export function createGlobalSearchExtensionPoint(): ExtensionPointSettings<
  ExtensionRenderContext,
  GlobalSearchContributionV1
> {
  return { id: GLOBAL_SEARCH_EXTENSION_POINT_ID, pluginId: 'core', mode: 'multiple' };
}
