import React, { createContext, useContext, useCallback, useSyncExternalStore } from 'react';
import invariant from 'ts-invariant';
import type { ExtensionPointRegistryContract, ExtensionPointStoreContract, ExtensionRenderContext } from '../types/extensions';

type ExtensionProviderProps = {
  /** Allow passing in a custom registry, purely for testing purposes */
  registry: ExtensionPointRegistryContract;
  children: React.ReactNode;
};

export type ExtensionProviderType = React.FC<ExtensionProviderProps>;

const ExtensionRegistryContext = createContext<ExtensionPointRegistryContract | undefined>(undefined);

export const useExtensionRegistry = (): ExtensionPointRegistryContract | undefined => {
  const registry = useContext(ExtensionRegistryContext);
  return registry;
};

/**
 * Hook to get an extension point store that reactively updates when contributions change.
 * Mounted consumers rerender when matching registry data changes.
 *
 * Uses a sentinel-based snapshot so that useSyncExternalStore detects contribution
 * mutations even though the store object reference is stable. The store exposes a
 * monotonically increasing `version` counter that increments on every register/unregister.
 */
export function useExtensionPoint<
  TValue = unknown,
  TContext = ExtensionRenderContext,
>(id: string): ExtensionPointStoreContract<TValue, TContext> | undefined {
  const registry = useExtensionRegistry();

  // Cache: tracks the last-seen store + version and the sentinel object returned
  // for that combination. A new sentinel is created only when something changed.
  const cacheRef = React.useRef<{
    store: ExtensionPointStoreContract<TValue, TContext> | undefined;
    version: number;
    sentinel: object;
  } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubs: Array<() => void> = [];

      if (registry) {
        unsubs.push(registry.subscribe(onStoreChange));
      }

      const store = registry?.getExtensionPoint<TValue, TContext>(id);
      if (store) {
        unsubs.push(store.subscribe(onStoreChange));
      }

      return () => {
        for (const unsub of unsubs) {
          unsub();
        }
      };
    },
    [registry, id],
  );

  const getSnapshot = useCallback(() => {
    const store = registry?.getExtensionPoint<TValue, TContext>(id);

    if (!store) {
      if (cacheRef.current && cacheRef.current.store === undefined) {
        return cacheRef.current.sentinel;
      }
      const sentinel = {};
      cacheRef.current = { store: undefined, version: -1, sentinel };
      return sentinel;
    }

    const cached = cacheRef.current;
    if (cached && cached.store === store && cached.version === store.version) {
      return cached.sentinel;
    }

    const sentinel = {};
    cacheRef.current = { store, version: store.version, sentinel };
    return sentinel;
  }, [registry, id]);

  // Drive re-renders via sentinel identity changes
  useSyncExternalStore(subscribe, getSnapshot);

  // Return the actual store for consumer use
  return registry?.getExtensionPoint<TValue, TContext>(id);
}

/**
 * ExtensionProvider houses the various locations where components from other plugins can inject
 * functionality (such as components).
 */
export const ExtensionProvider: React.FC<ExtensionProviderProps> = ({ registry, children }) => {
  const initialRegistry = React.useRef<ExtensionPointRegistryContract>(registry);

  React.useEffect(() => {
    invariant(
      initialRegistry.current === registry,
      'You can\'t change the extension registry after it has been rendered',
    );
  }, [registry]);

  return (
    <ExtensionRegistryContext.Provider value={initialRegistry.current}>
      {children}
    </ExtensionRegistryContext.Provider>
  );
};

export default ExtensionProvider;
