import React, { createContext, useContext } from 'react';
import { ExtensionPointRegistry } from './registry';
import invariant from 'ts-invariant';
import { ExtensionPointStore } from '../types';

type ExtensionProviderProps = {
  /** Allow passing in a custom registry, purely for testing purposes */
  registry: ExtensionPointRegistry;
  children: React.ReactNode;
};

export type ExtensionProviderType = React.FC<ExtensionProviderProps>;

const ExtensionRegistryContext = createContext<ExtensionPointRegistry | undefined>(undefined);

export const useExtensionRegistry = (): ExtensionPointRegistry | undefined => {
  const registry = useContext(ExtensionRegistryContext);
  return registry;
};

export const useExtensionPoint = <T,>(id: string): ExtensionPointStore<T> | undefined => {
  const registry = useExtensionRegistry();
  return registry?.getExtensionPoint<T>(id);
};

export const useExtensionPointComponents = <T,>(id: string): Array<React.Component<T>> => {
  const registry = useExtensionRegistry();
  const extensionPoint = registry?.getExtensionPoint<T>(id);
  if (!extensionPoint) {
    return [];
  }
  return extensionPoint.provide({ getCacheKey: () => id });
}

/**
 * ExtensionProvider houses the various locations where components from other plugins can inject
 * functionality (such as components).
 */
export const ExtensionProvider: React.FC<ExtensionProviderProps> = ({ registry, children }) => {
  const initialRegistry = React.useRef<ExtensionPointRegistry>(registry);

  React.useEffect(() => {
    invariant(
      initialRegistry.current === registry,
      'You can\'t change the extension registry after it has been rendered'
    );
  }, [registry]);

  return (
    <ExtensionRegistryContext.Provider value={initialRegistry.current}>
      {React.Children.only(children)}
    </ExtensionRegistryContext.Provider>
  );
};

export default ExtensionProvider;
