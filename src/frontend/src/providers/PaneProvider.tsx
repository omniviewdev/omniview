import { core, scoped } from "@/routes";
import React, { useMemo } from "react";
import { createBrowserRouter, createMemoryRouter, Outlet, RouterProvider, UNSAFE_LocationContext, useLocation } from "react-router-dom";
import Box from "@mui/joy/Box";
import PaneProviderContext, { PaneContext, IPaneProviderContext, Pane } from "@/contexts/PaneContext";
import usePanes from "@/hooks/usePanes";


/**
* Provides the primary renderer for the application. This renderer
* is responsible for rendering the panes and the core application
* layout.
*/
export const Renderer: React.FC = () => {
  const coreRouter = createBrowserRouter(core);

  /** Start with a single pane */
  const [panes, setPanesStore] = React.useState<Pane[]>([{
    id: window.crypto.randomUUID(),
    router: createMemoryRouter(scoped),
  }]);

  /** Set the panes for the pane renderer */
  const setPanes: IPaneProviderContext['setPanes'] = (panes) => {
    setPanesStore(panes);
  }

  /** Add a new pane to the pane renderer */
  const addNewPane: IPaneProviderContext['addNewPane'] = () => {
    setPanesStore([...panes, {
      id: window.crypto.randomUUID(),
      router: createMemoryRouter(scoped),
    }]);
  }

  /** Remove a pane from the pane renderer */
  const removePane: IPaneProviderContext['removePane'] = (id: string) => {
    setPanesStore(panes.filter((pane) => id !== pane.id));
  }

  /** Memoize the context value to avoid unnecessary re-renders */
  const contextValue = useMemo(() => ({
    panes,
    numPanes: panes.length,
    setPanes,
    addNewPane,
    removePane,
  }), [panes, setPanes, addNewPane, removePane]);

  return (
    <PaneProviderContext.Provider value={contextValue}>
      <RouterProvider router={coreRouter} />
    </PaneProviderContext.Provider>
  )
};

export default function PaneRenderer() {
  const { pathname } = useLocation();
  const { panes } = usePanes();

  /**
   * If the pathname is the root, we're within the context
   * of the pane renderer. Other routes are pure application routes controlled by
   * the core application router.
   */
  if (pathname === '/') return (
    <Box sx={{ width: 1 }}>
      <Box display="grid" gridTemplateColumns="repeat(12, 1fr)" gap={0}>
        {panes.map((pane, index) => {
          const addRightBorder = index !== panes.length - 1;
          return (
            <Box
              sx={{ borderRight: (theme) => addRightBorder ? `2px solid ${theme.palette.neutral[700]}` : 'none' }}
              gridColumn={`span ${panes.length == 0 ? 12 : 12 / panes.length}`}
              key={index}
            >
              <PaneContext.Provider value={{ id: pane.id }}>


                {/* Dirty hack to kill the route context propogation 
                https://github.com/remix-run/react-router/issues/7375#issuecomment-975431736
                @ts-ignore */}
                <UNSAFE_LocationContext.Provider value={null}>
                  <RouterProvider router={pane.router} fallbackElement={<div>Loading...</div>} />
                </UNSAFE_LocationContext.Provider>

              </PaneContext.Provider>
            </Box>
          )
        })}
      </Box>
    </Box>
  )

  return <Outlet />;
}
