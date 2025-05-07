import React from 'react';

import { PluginContextProvider } from '@omniviewdev/runtime';
import { Outlet, useLoaderData } from 'react-router-dom';
import { clearPlugin, loadAndRegisterPlugin } from '../api/loader';
import { EventsOn, WindowReloadApp } from '@omniviewdev/runtime/runtime';
import { type config } from '@omniviewdev/runtime/models';

export type PluginRendererProps = {}

// /**
//  * Renders out the plugin routes using the component router.
//  *
//  * NOTE: tried using the RouterProvider, but it doesn't reload when navigating
//  * between plugins. I assume something to with memoization, so we can come back
//  * to this eventually if we need to.
//  */
// const PluginRoutes: React.FC<{ plugin: PluginWindow }> = ({ plugin }) => {
//   if (!plugin?.root) {
//     console.log('Plugin does not have a root page')
//     return <></>
//   }
//
//   console.log('Rendering plugin routes', plugin.pages)
//
//   return (
//     <MemoryRouter>
//       <Routes>
//         <Route path="/" element={<plugin.root />} />
//         {Object.entries(plugin.pages || {}).map(([path, Element]) => (
//           <Route key={path} path={path} element={<Element />} />
//         ))}
//       </Routes>
//     </MemoryRouter>
//   )
// }

/**
 * PluginRenderer loads a plugin with a UI entrypoint, injecting the necessary
 * contexts and rendering the component.
 *
 * In order for a plugin to get loaded here, it must have the "ui" capability added
 * and a reachable `entrypoint` in the manifest (or it must not be specified, in which
 * it will default to the `entry.js` entrypoint).
 *
 * This uses SystemJS to load the plugin and attach extension points into the registry.
 * Anything here should be automatically preloaded by the preloader, so that we don't have
 * to deal with various loading states.
 */
const PluginRenderer: React.FC<PluginRendererProps> = () => {
  const data = useLoaderData() as { pluginID: string } | undefined

  /**
   * Load the plugin window on first mount
   */
  React.useEffect(() => {
    const closer = EventsOn('plugin/dev_reload_complete', (meta: config.PluginMeta) => {
      if (!!data?.pluginID && meta.id === data.pluginID) {
        clearPlugin({ pluginId: data?.pluginID })
          .then(() => loadAndRegisterPlugin(data.pluginID))
          .then(WindowReloadApp)
          .catch((error) => {
            console.error('Error clearing plugin', error)
          })
      }
    })
    return () => {
      // Cleanup watchers
      closer()
    };
  }, [data?.pluginID])


  if (!data?.pluginID) {
    return <>No Plugin ID found</>
  }

  return (
    <PluginContextProvider pluginId={data.pluginID}>
      <Outlet />
    </PluginContextProvider>
  )
}

export default PluginRenderer
