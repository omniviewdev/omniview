import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import initialStores from './builtin';
import { ensureBuiltinExtensionPointsRegistered } from './registerBuiltinExtensionPoints';
import { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from './sidebar/extensionPoint';

// The provider and plugin adapters share one registry for the document lifetime.
// A runtime dependency update must not replace it underneath mounted providers.
const retainedRegistry = import.meta.hot?.data.extensionRegistry as
  InstanceType<typeof ExtensionPointRegistry> | undefined;
export const EXTENSION_REGISTRY = retainedRegistry ?? new ExtensionPointRegistry({
  initialStores: initialStores.filter((store) => store.id !== RESOURCE_SIDEBAR_EXTENSION_POINT_ID),
});
if (import.meta.hot) import.meta.hot.data.extensionRegistry = EXTENSION_REGISTRY;

// Register resource builtins with proper matchers, ownership, and cache key support.
ensureBuiltinExtensionPointsRegistered(EXTENSION_REGISTRY);
