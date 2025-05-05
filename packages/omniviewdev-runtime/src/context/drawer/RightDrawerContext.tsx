import { createContext } from 'react';
import { DrawerComponent, DrawerContext } from './types';

export interface RightDrawerContextType {
  openDrawer: (component: DrawerComponent, ctx: DrawerContext) => void;
  closeDrawer: () => void;
  isOpen: boolean;
}

export const RightDrawerContext = createContext<RightDrawerContextType | undefined>(undefined);
