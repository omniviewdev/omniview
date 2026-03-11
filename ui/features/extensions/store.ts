import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import initialStores from './builtin';
import { ensureBuiltinExtensionPointsRegistered } from './registerBuiltinExtensionPoints';

// Create registry with non-resource builtins (dashboard, homepage, logviewer, sidebar action/widget).
// Filter out the resource sidebar infopanel — it will be registered by
// ensureBuiltinExtensionPointsRegistered with proper matchers.
const nonResourceStores = initialStores.filter(
  (s) => s.id !== 'omniview/resource/sidebar/infopanel',
);

export const EXTENSION_REGISTRY = new ExtensionPointRegistry({ initialStores: nonResourceStores });

// Register resource builtins with proper matchers, ownership, and cache key support.
ensureBuiltinExtensionPointsRegistered(EXTENSION_REGISTRY);
