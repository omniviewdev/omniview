import { Suspense, lazy } from 'react';

/* @ts-expect-error - accessing window object primative */
import { __federation_method_setRemote, __federation_method_getRemote } from '__federation__';

type PluginComponentProps = {
  [key: string]: any;
  fallback?: React.ReactNode;
  plugin: string;
  component: string;
};


/**
 * Dynamically load a federated plugin component from the plugin system.
 */
const PluginComponent: React.FC<PluginComponentProps> = ({ plugin, component, fallback, ...rest }) => {
  const RemotePluginComponent = lazy(() => {
    __federation_method_setRemote(plugin, {
      url: async () => Promise.resolve(`${window.location.protocol + '//' + window.location.host}/_/plugins/${plugin}/assets/remoteEntry.js`),
      format: 'esm',
      from: 'vite',
    });

    if (!component.startsWith('./')) {
      component = `./${component}`;
    }

    return __federation_method_getRemote(plugin, component)
      .catch((error: Error) => ({ default: () => <div>{`${error.message}`}</div> }));
  });

  return (
    <Suspense fallback={fallback}>
      <RemotePluginComponent {...rest} />
    </Suspense>
  );
};


export default PluginComponent;
