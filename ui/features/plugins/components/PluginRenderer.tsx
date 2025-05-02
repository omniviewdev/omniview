import React from 'react';

import { PluginContextProvider, PluginWindow } from '@omniviewdev/runtime';
import { UNSAFE_LocationContext, useParams } from 'react-router-dom';
import { clearPlugin, importPluginWindow } from '../api/loader';
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
  const { pluginId } = useParams<{ pluginId: string }>()
  const [plugin, setPlugin] = React.useState<PluginWindow | undefined>()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | undefined>()

  /**
   * Load the plugin window on first mount
   */
  React.useEffect(() => {
    console.log('Loading plugin', pluginId)

    if (!pluginId) {
      return
    }
    const loadPlugin = async () => {
      try {
        const loaded = await importPluginWindow({ pluginId })
        setPlugin(loaded)
        setError(undefined)
      } catch (error) {
        console.log(error)
        if (error instanceof Error) {
          setError(error)
        }
        setPlugin(undefined)
      } finally {
        setLoading(false)
      }
    }

    loadPlugin()

    const closer = EventsOn('plugin/dev_reload_complete', (meta: config.PluginMeta) => {
      if (meta.id === pluginId) {
        clearPlugin({ pluginId })
          .then(loadPlugin)
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
  }, [pluginId])


  /** TODO: make this more robust */
  if (!pluginId) {
    return <div></div>
  }

  /** TODO: make this more robust */
  if (!plugin && loading) {
    return <div></div>
  }

  if (!plugin && error) {
    return (
      <div>
        Error loading plugin
        <pre>
          {error.name}
        </pre>
        <pre>
          {error.message}
        </pre>
        <pre>
          {error.stack}
        </pre>
      </div>
    )
  }

  if (!plugin?.root) {
    return <div>Plugin does not have a root page</div>
  }

  return (
    <PluginContextProvider pluginId={pluginId}>
      {/* @ts-expect-error - Dirty hack to kill the route context propogation https://github.com/remix-run/react-router/issues/7375#issuecomment-975431736 */}
      <UNSAFE_LocationContext.Provider value={null}>
        {plugin.Window}
      </UNSAFE_LocationContext.Provider>
    </PluginContextProvider>
  )
}

export default PluginRenderer
