import { createContext, useContext } from 'react';
import type { DrawerComponent } from '@omniviewdev/runtime';

/**
 * Provides the DrawerComponent (with its actions array) to table cells.
 * This lets ActionsCell read the drawer's actions without threading
 * the drawer through the column definition system.
 */
export const TableDrawerContext = createContext<DrawerComponent | undefined>(undefined);

export function useTableDrawer(): DrawerComponent | undefined {
  return useContext(TableDrawerContext);
}
