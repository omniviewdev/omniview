import React, { createContext, useContext, useEffect, useRef } from 'react';
import { ExtensionPointRegistry } from './registry';
import invariant from 'ts-invariant';
import initialStores from './defaultStores';

type ExtensionProviderProps = {
  registry: ExtensionRegistry;
  children: React.ReactNode;
};

type ExtensionRegistry = {
  extensionPointRegistry: ExtensionPointRegistry;
};

export type ExtensionProviderType = React.FC<ExtensionProviderProps>;
const ExtensionRegistryContext = createContext<ExtensionRegistry | undefined>(undefined);

const useExtensionRegistry = (): ExtensionRegistry | undefined => {
  const registry = useContext(ExtensionRegistryContext);
  return registry;
};

export const createExtensionRegistry = (): ExtensionRegistry => {
  return {
    extensionPointRegistry: new ExtensionPointRegistry({ initialStores }),
  };
};

const ExtensionProvider: React.FC<ExtensionProviderProps> = ({ registry, children }) => {
  const initialRegistry = useRef<ExtensionRegistry>(registry);

  useEffect(() => {
    invariant(
      initialRegistry.current === registry,
      'You can\'t change the extension registry after it has been rendered'
    );
  }, [registry]);

  return (
    <ExtensionRegistryContext.Provider value={registry}>
      {React.Children.only(children)}
    </ExtensionRegistryContext.Provider>
  );
};

export default ExtensionProvider;
export { useExtensionRegistry };
