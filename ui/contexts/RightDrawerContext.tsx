import React from 'react';

export type DrawerContent = {
  // You can extend this type based on the different kinds of content you expect
};

export type ShowResourceSidebarParams = {
  pluginID: string;
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  namespace: string;
};


export type RightDrawerContextType = {
  closeDrawer: () => void;
  showResourceSidebar: (params: ShowResourceSidebarParams) => void;
};

// Create a context with a default dummy implementation to avoid the need to check for undefined
/* eslint-disable @typescript-eslint/no-empty-function */
const defaultState: RightDrawerContextType = {
  closeDrawer() { },
  showResourceSidebar() { },
};

const RightDrawerContext = React.createContext<RightDrawerContextType>(defaultState);

export default RightDrawerContext;
