import { scoped } from '@/routes';
import React, { useMemo } from 'react';
import {
  createHashRouter, createMemoryRouter, Outlet, RouterProvider, UNSAFE_LocationContext, useLocation,
} from 'react-router-dom';
import Box from '@mui/material/Box';
import PaneProviderContext, { PaneContext, type PaneProviderContextType, type Pane } from '@/contexts/PaneContext';
import usePanes from '@/hooks/usePanes';
import BottomDrawerProvider from './BottomDrawer/provider';

/**
* Provides the primary renderer for the application. This renderer
* is responsible for rendering the panes and the core application
* layout.
*/
export const Renderer: React.FC = () => {
  const coreRouter = createHashRouter(scoped);

  /** Start with a single pane */
  const [panes, setPanesStore] = React.useState<Pane[]>([{
    id: window.crypto.randomUUID(),
    router: createMemoryRouter(scoped),
  }]);

  /** Set the panes for the pane renderer */
  const setPanes: PaneProviderContextType['setPanes'] = panes => {
    setPanesStore(panes);
  };

  /** Add a new pane to the pane renderer */
  const addNewPane: PaneProviderContextType['addNewPane'] = () => {
    setPanesStore([...panes, {
      id: window.crypto.randomUUID(),
      router: createMemoryRouter(scoped),
    }]);
  };

  /** Remove a pane from the pane renderer */
  const removePane: PaneProviderContextType['removePane'] = (id: string) => {
    setPanesStore(panes.filter(pane => id !== pane.id));
  };

  /** Memoize the context value to avoid unnecessary re-renders */
  const contextValue = useMemo(() => ({
    panes,
    numPanes: panes.length,
    setPanes,
    addNewPane,
    removePane,
  }), [panes, setPanes, addNewPane, removePane]);

  console.log("PANES: ", panes)

  return (
    <PaneProviderContext.Provider value={contextValue}>
      <RouterProvider router={coreRouter} />
    </PaneProviderContext.Provider>
  );
};

export default function PaneRenderer() {
  const { pathname } = useLocation();
  const { panes } = usePanes();

  console.log("IN PANE RENDERER, PATHNAME: %s", pathname)
  console.log("IN PANE RENDERER, PANES", panes)

  /**
   * If the pathname is the root, we're within the context
   * of the pane renderer. Other routes are pure application routes controlled by
   * the core application router.
   */
  if (pathname === '/') {
    return (
      <Box sx={{ width: 1 }}>
        <Box display='grid' gridTemplateColumns='repeat(12, 1fr)' gap={0}>
          {panes.map((pane, index) => {
            console.log("rendering pane")
            const addRightBorder = index !== panes.length - 1;
            return (
              <Box
                sx={{ borderRight: theme => addRightBorder ? `2px solid ${theme.palette.neutral[700]}` : 'none' }}
                gridColumn={`span ${panes.length == 0 ? 12 : 12 / panes.length}`}
                key={index}
              >
                <PaneContext.Provider value={{ id: pane.id }}>
                  {/* @ts-expect-error - Dirty hack to kill the route context propogation https://github.com/remix-run/react-router/issues/7375#issuecomment-975431736 */}
                  <UNSAFE_LocationContext.Provider value={null}>
                    <BottomDrawerProvider>
                      <RouterProvider router={pane.router} fallbackElement={<div>Loading...</div>} />
                    </BottomDrawerProvider>
                  </UNSAFE_LocationContext.Provider>
                </PaneContext.Provider>
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  }

  return <Outlet />;
}
