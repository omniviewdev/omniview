import React from 'react';

// import { __federation_method_setRemote, __federation_method_getRemote, __federation_method_unwrapDefault } from '__federation__';
import EB from '@/ErrorBoundary';

type PluginComponentProps = {
  [key: string]: any;
  fallback?: React.ReactNode;
  plugin: string;
  component: string;
};

// A cache to store loaded component promises to avoid refetching
// const setCache = new Map<string, boolean>();
const componentCache = new Map<string, any>();

/**
 * Preload a federated plugin component from the plugin system into the component cache.
 */
export const preload = async (plugin: string, component: string) => {
  const cacheKey = `${plugin}:${component}`;
  if (componentCache.has(cacheKey)) {
    return;
  }

  // loadComponent(plugin, component);
};

// const loadComponent = (plugin: string, component: string) => {
//   const cacheKey = `${plugin}:${component}`;
//
//   // await import(`${window.location.protocol}//${window.location.host}/_/plugins/${plugin}/assets/remoteEntry.js`);
//
//   if (!setCache.has(cacheKey)) {
//   // Setup the federation remote configuration
//     // __federation_method_setRemote(plugin, {
//     //   url: `${window.location.protocol}//${window.location.host}/_/plugins/${plugin}/assets/remoteEntry.js`,
//     //   format: 'esm',
//     //   from: 'vite',
//     // });
//     setCache.set(cacheKey, true);
//   }
//
//   if (!component.startsWith('./')) {
//     component = `./${component}`;
//   }
//
//   return ({ default: () => <></>})
//   // return __federation_method_getRemote(plugin, component).catch((_e: any) => ({
//   //   default: () => <></>,
//   // }));
// };

// const AsyncComponent = React.memo(loadable((props: any) => loadComponent(props.plugin, props.component), {
//   cacheKey: (props: any) => `${props.plugin}:${props.component}`,
// }), (prev, next) => prev.plugin === next.plugin && prev.component === next.component);
//
/**
 * Dynamically load a federated plugin component from the plugin system.
 */
const PluginComponent: React.FC<PluginComponentProps> = (_) => {
  // const RemotePluginComponent = React.useMemo(() => lazyWithRetries(() => loadComponent(plugin, component)), [plugin, component]);
  // const cacheKey = `${plugin}:${component}`;

  return (
    <EB>
      <div></div>
    </EB>
  );
};


export default PluginComponent;
