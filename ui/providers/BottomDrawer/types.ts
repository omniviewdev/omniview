import type React from 'react';

// action types
export type BottomDrawerTab = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  icon?: string | React.ReactNode;
  variant: 'terminal' | 'logs' | 'editor' | 'browser' | 'file' | 'other';
  properties?: Record<string, unknown>;
};

export type FindTabOpts = {
  /** ID of the tab to focus, if known */
  id?: string;

  /** Index of the tab, if known. If provided, it will be prioritized over all other options */
  index?: number;

  /** Properties to match against */
  properties?: Record<string, unknown>;

  /** 
   * Customize the behavior when multiple tabs match the properties. The options are:
   *  - 'first': Perform on the first matching tab.
   *  - 'newest': Perform the most recently created tab.
   *  - 'oldest': Perform the oldest tab
   *  - 'none': Do nothing
   */
  actionOnMultiple?: 'first' | 'newest' | 'oldest' | 'none';
};

export type CreateTabOpts = Pick<BottomDrawerTab, 'title' | 'icon' | 'variant' | 'properties'> & {
  id?: string;
};

/**
 * Create a new tab in the bottom drawer.
 */
export type CreateTab = (opts: CreateTabOpts) => void;

/**
 * Create multiple tabs in the bottom drawer.
 */
export type CreateTabs = (opts: CreateTabOpts[]) => void;

/**
* Focus on a tab in the bottom drawer. If multiple tabs match the search criteria, the 'newest' tab will be focused.
*/
export type FocusTab = (opts: FindTabOpts) => void;

/**
 * Reorder a tab in the bottom drawer, given the 'from' and 'to' indexes.
 */
export type ReorderTab = (from: number, to: number) => void;

/**
 * Close a tab in the bottom drawer. If multiple tabs match the search criteria, no tabs will be closed.
 */
export type CloseTab = (opts: FindTabOpts) => void;

/**
* Close multiple tabs in the bottom drawer.
*/
export type CloseTabs = (opts: FindTabOpts[]) => void;

/**
 * Resize the height of the bottom drawer programatically, in pixels.
 */
export type ResizeDrawer = (height: number) => void;

/**
 * Expand the bottom drawer to take up the full height of view.
 */
export type FullscreenDrawer = () => void;

/**
 * Collapse the bottom drawer to its default height.
 */
export type CloseDrawer = () => void;
