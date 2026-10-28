import { createContext } from 'react';
import { DrawerComponent, DrawerContext } from './types';

export type ShowResourceSidebarParams = {
  pluginID: string;
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  resourceName?: string;
  namespace?: string;
  validateData?: (data: unknown) => boolean;
  signal?: AbortSignal;
};

export interface RightDrawerContextType {
  openDrawer: (component: DrawerComponent, ctx: DrawerContext) => void;
  closeDrawer: () => void;
  showResourceSidebar: (params: ShowResourceSidebarParams) => Promise<void>;
  isOpen: boolean;
}

export const RightDrawerContext = createContext<RightDrawerContextType | undefined>(undefined);
