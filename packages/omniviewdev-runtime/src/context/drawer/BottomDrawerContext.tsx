import React from 'react';
import {
  type CreateTab,
  type FocusTab,
  type CloseDrawer,
  type FullscreenDrawer,
  type CloseTab,
  type ResizeDrawer,
  type BottomDrawerTab,
  type CreateTabs,
  type CloseTabs,
  type ReorderTab,
  type UpdateTab,
} from './types';

// ===================================== CONTEXT ===================================== //

export type BottomDrawerContextType = {
  height: number;
  focused: number;
  tabs: BottomDrawerTab[];
  createTab: CreateTab;
  createTabs: CreateTabs;
  updateTab: UpdateTab;
  focusTab: FocusTab;
  closeTab: CloseTab;
  closeTabs: CloseTabs;
  reorderTab: ReorderTab;
  resizeDrawer: ResizeDrawer;
  closeDrawer: CloseDrawer;
  fullscreenDrawer: FullscreenDrawer;
};

// Create a context with a default dummy implementation to avoid the need to check for undefined
/* eslint-disable @typescript-eslint/no-empty-function */
export const defaultState: BottomDrawerContextType = {
  height: 32,
  focused: 0,
  tabs: [],
  createTab: () => { },
  createTabs: () => { },
  updateTab: () => { },
  focusTab: () => { },
  reorderTab: () => { },
  closeTab: () => { },
  closeTabs: () => { },
  resizeDrawer: () => { },
  closeDrawer: () => { },
  fullscreenDrawer: () => { },
};

export const BottomDrawerContext = React.createContext<BottomDrawerContextType>(defaultState);
export default BottomDrawerContext;
