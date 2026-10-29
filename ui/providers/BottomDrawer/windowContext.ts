import React from 'react';
import type { DrawerMode, SerializedDrawerTab } from './drawerSlot';

export const DEFAULT_DRAWER_EXPANDED_HEIGHT = 550;

export type DrawerLayout = {
  mode: DrawerMode;
  /** Last expanded (non-minimized, non-fullscreen) drawer height in px. */
  expandedHeight: number;
};

export type AdoptDrawerTabsPlacement = {
  /** Insert position; defaults to the end of the strip. */
  index?: number;
  /**
   * Adopted tab to focus. Without it the tabs are appended quietly: focus
   * stays where it is and the drawer does not auto-expand for them.
   */
  focusTabId?: string;
};

/**
 * Host-only drawer operations for multi-window: moving tabs between windows and
 * the drawer's persisted layout. Plugins use the runtime `BottomDrawerContext`.
 */
export type BottomDrawerWindowContextType = {
  /** False until restored tabs were reconciled with the live backend sessions. */
  restoreComplete: boolean;
  /** Tabs that reappeared (restore, closed window) and must not auto-expand the drawer. */
  quietTabIds: ReadonlySet<string>;
  layout: DrawerLayout;
  /** Records the drawer mode; `expandedHeight` updates the remembered expanded height. */
  saveLayout: (mode: DrawerMode, expandedHeight?: number) => void;
  /** Removes a tab that now lives in another window, keeping its backend session alive. */
  transferTabOut: (id: string) => void;
  /**
   * Inserts serialized tabs from another window. Pending tabs and ids this
   * window already shows are refused. Returns whether any tab was adopted.
   */
  adoptTabs: (tabs: SerializedDrawerTab[], placement: AdoptDrawerTabsPlacement) => boolean;
};

export const BottomDrawerWindowContext = React.createContext<BottomDrawerWindowContextType | null>(null);

export function useBottomDrawerWindow(): BottomDrawerWindowContextType {
  const context = React.useContext(BottomDrawerWindowContext);
  if (context === null) {
    throw new Error('useBottomDrawerWindow must be used within a BottomDrawerProvider');
  }

  return context;
}
