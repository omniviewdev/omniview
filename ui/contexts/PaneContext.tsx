import React from 'react';
import { type createMemoryRouter } from 'react-router-dom';

export type Pane = {
  id: string;
  router: ReturnType<typeof createMemoryRouter>;
};

export type PaneContextType = {
  id: string;
};

export const PaneContext = React.createContext<PaneContextType | undefined>(undefined);

export type PaneProviderContextType = {
  panes: Pane[];
  numPanes: number;
  setPanes: (panes: Pane[]) => void;
  addNewPane: () => void;
  removePane: (id: string) => void;
};

// Create a context with a default dummy implementation to avoid the need to check for undefined
const defaultState: PaneProviderContextType = {
  panes: [],
  numPanes: 0,
  setPanes() { },
  addNewPane() { },
  removePane() { },
};

export const PaneProviderContext = React.createContext<PaneProviderContextType>(defaultState);

export default PaneProviderContext;
