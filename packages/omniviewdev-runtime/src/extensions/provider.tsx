import React, { createContext, useContext, useCallback, useSyncExternalStore } from 'react';
import invariant from 'ts-invariant';
import type { ExtensionContributionRegistration, ExtensionPointRegistryContract, ExtensionPointStoreContract, ExtensionRenderContext } from '../types/extensions';

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

export interface ExtensionPointSnapshot<TValue = unknown, TContext = ExtensionRenderContext> {
  readonly store: ExtensionPointStoreContract<TValue, TContext> | undefined;
  readonly version: number;
  readonly contributions: readonly ExtensionContributionRegistration<TValue>[];
}

/** Immutable render input; a stable mutable store is not a React Compiler dependency. */
export function useExtensionPointSnapshot<
  TValue = unknown,
  TContext = ExtensionRenderContext,
>(id: string): ExtensionPointSnapshot<TValue, TContext> {
  const registry = useExtensionRegistry();
  const cacheRef = React.useRef<ExtensionPointSnapshot<TValue, TContext> | null>(null);
  const subscribe = useCallback((onStoreChange: () => void) => {
    let store = registry?.getExtensionPoint<TValue, TContext>(id);
    let unsubscribeStore = store?.subscribe(onStoreChange);
    const unsubscribeRegistry = registry?.subscribe(() => {
      const next = registry.getExtensionPoint<TValue, TContext>(id);
      if (next !== store) {
        unsubscribeStore?.();
        store = next;
        unsubscribeStore = store?.subscribe(onStoreChange);
      }
      onStoreChange();
    });
    return () => {
      unsubscribeStore?.();
      unsubscribeRegistry?.();
    };
  }, [registry, id]);
  const getSnapshot = useCallback(() => {
    const store = registry?.getExtensionPoint<TValue, TContext>(id);
    const version = store?.version ?? -1;
    const cached = cacheRef.current;
    if (cached && cached.store === store && cached.version === version) return cached;
    const snapshot: ExtensionPointSnapshot<TValue, TContext> = {
      store,
      version,
      contributions: store?.listAll() ?? [],
    };
    cacheRef.current = snapshot;
    return snapshot;
  }, [registry, id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Access the live store for imperative matching and registration. */
export function useExtensionPoint<
  TValue = unknown,
  TContext = ExtensionRenderContext,
>(id: string): ExtensionPointStoreContract<TValue, TContext> | undefined {
  return useExtensionPointSnapshot<TValue, TContext>(id).store;
}

/**
 * ExtensionProvider houses the various locations where components from other plugins can inject
 * functionality (such as components).
 */
export const ExtensionProvider: React.FC<ExtensionProviderProps> = ({ registry, children }) => {
  const [initialRegistry] = React.useState<ExtensionPointRegistryContract>(() => registry);

  // Synchronous check — throw before children render with a different registry
  invariant(
    initialRegistry === registry,
    'You can\'t change the extension registry after it has been rendered',
  );

  return (
    <ExtensionRegistryContext.Provider value={initialRegistry}>
      {children}
    </ExtensionRegistryContext.Provider>
  );
};

export default ExtensionProvider;
