import React from 'react';

export interface DrawerContent {
  // You can extend this type based on the different kinds of content you expect
}

export interface RightDrawerContextType {
  showResourceSpec(type: string, title: string, content: DrawerContent): void;
  openDrawer: (type: string, title: string, content: DrawerContent) => void;
  closeDrawer: () => void;
}

// Create a context with a default dummy implementation to avoid the need to check for undefined
const defaultState: RightDrawerContextType = {
  showResourceSpec: () => { },
  openDrawer: () => { },
  closeDrawer: () => { },
};

const RightDrawerContext = React.createContext<RightDrawerContextType>(defaultState);

export default RightDrawerContext;
