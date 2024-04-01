import React, { type ReactNode } from 'react';
import BottomDrawerContext from '@/contexts/BottomDrawerContext';
import { 
  type BottomDrawerTab, 
  type CloseDrawer, 
  type CreateTab, 
  type CreateTabOpts, 
  type FindTabOpts, 
  type FocusTab, 
  type FullscreenDrawer, 
  type ResizeDrawer, 
  type CloseTab,
  type ReorderTab,
} from './types';
import { TerminateSession } from '@api/terminal/TerminalManager';

type BottomDrawerProviderProps = {
  children: ReactNode;
};

/** Utility function to search for the matching tab */
const findTabIndex = (tabs: BottomDrawerTab[], opts: FindTabOpts): number => {
  if (opts.index !== undefined) {
    if (opts.index < 0 || opts.index >= tabs.length) {
      return -1;
    }

    return opts.index;
  }

  if (opts.id !== undefined) {
    return tabs.findIndex((tab) => tab.id === opts.id);
  }

  if (opts.properties !== undefined) {
    const matches = tabs.filter((tab) => {
      if (tab.properties === undefined) {
        return false;
      }

      return Object.keys(opts.properties ?? {}).every((key) => tab.properties?.[key] === opts.properties?.[key]);
    });
    if (matches.length === 0) {
      return -1;
    }

    if (matches.length === 1) {
      return tabs.indexOf(matches[0]);
    }

    switch (opts.actionOnMultiple) {
      case 'first':
        return tabs.indexOf(matches[0]);
      case 'newest':
        return tabs.indexOf(matches[matches.length - 1]);
      case 'oldest':
        return tabs.indexOf(matches[0]);
      default:
        return -1;
    }
  }

  return -1;
};

export const BottomDrawerProvider: React.FC<BottomDrawerProviderProps> = ({ children }) => {
  const defaultHeight = 32;

  const [focused, setFocused] = React.useState<number>(0);
  const [tabs, setTabs] = React.useState<BottomDrawerTab[]>([]);
  const [drawerHeight, setDrawerHeight] = React.useState<number>(defaultHeight);

  // ===================================== CONTEXT METHODS ===================================== //

  const createTab: CreateTab = (opts: CreateTabOpts) => {
    const id = opts.id ?? window.crypto.randomUUID();

    const newTab: BottomDrawerTab = {
      id,
      icon: opts.icon,
      title: opts.title,
      createdAt: new Date(),
      updatedAt: new Date(),
      variant: opts.variant,
      properties: opts.properties,
    };
    setTabs([...tabs, newTab]);
  };

  const focusTab: FocusTab = (opts: FindTabOpts) => {  
    const foundIndex = findTabIndex(tabs, { actionOnMultiple: 'newest', ...opts });
    if (foundIndex === -1) {
      return;
    }

    setFocused(foundIndex);
  };

  const reorderTab: ReorderTab = (from: number, to: number) => {
    if (from === to) {
      return;
    }

    if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) {
      return;
    }

    const draft = [...tabs];
    const [tab] = draft.splice(from, 1);
    draft.splice(to, 0, tab);
    setTabs(draft);
  };

  const closeTab: CloseTab = (opts: FindTabOpts) => {
    const foundIndex = findTabIndex(tabs, opts);
    if (foundIndex === -1) {
      return;
    }

    const tab = tabs[foundIndex];

    // if terminal, close the session
    if (tab.variant === 'terminal') {
      TerminateSession(tab.id).catch((err) => {
        if (err instanceof Error) {
          console.error('failed to terminate session: ', err.message);
          return;
        }
      });
    }

    setTabs((prevTabs) => prevTabs.filter((_, i) => i !== foundIndex));
    setFocused(Math.max(foundIndex - 1, 0));
  };

  const resizeDrawer: ResizeDrawer = (height: number) => {
    if (height < defaultHeight) {
      setDrawerHeight(defaultHeight);
      return;
    }

    if (height > window.innerHeight) {
      setDrawerHeight(window.innerHeight);
      return;
    }

    setDrawerHeight(height);
  };

  const closeDrawer: CloseDrawer = () => {
    setDrawerHeight(defaultHeight);
  };

  const fullscreenDrawer: FullscreenDrawer = () => {
    // calculate from the window 
    setDrawerHeight(window.innerHeight);
  };

  // ===================================== CONTEXT VALUE ===================================== //

  const value = React.useMemo(() => ({
    height: drawerHeight,
    focused,
    tabs,
    createTab,
    focusTab,
    reorderTab,
    closeTab,
    resizeDrawer,
    closeDrawer,
    fullscreenDrawer,
  }), [drawerHeight, focused, tabs]);

  return (
    <BottomDrawerContext.Provider value={value}>
      {children}
    </BottomDrawerContext.Provider>
  );
};

export default BottomDrawerProvider;
