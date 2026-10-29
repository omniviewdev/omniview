import React from 'react';

export type OpenInNewTabOptions = {
  /** Keep the current tab active; the new tab opens behind it. */
  background?: boolean;
};

/**
 * Opens host routes (e.g. `/_plugin/kubernetes/cluster/abc/resources`) outside
 * the current page tab. The host application provides the implementation.
 */
export type WindowActions = {
  /** Opens the path in a new page tab next to the current one. */
  openInNewTab: (path: string, options?: OpenInNewTabOptions) => void;
  /** Opens the path in a new workspace window. */
  openInNewWindow: (path: string) => void;
  /** Opens the path in a new tab in the side-by-side pane, splitting the view if needed. */
  openInSplit: (path: string) => void;
};

export const WindowActionsContext = React.createContext<WindowActions | null>(null);

export const WindowActionsProvider: React.FC<{ actions: WindowActions; children: React.ReactNode }> = ({ actions, children }) => (
  <WindowActionsContext.Provider value={actions}>{children}</WindowActionsContext.Provider>
);

/**
 * Window-level navigation for plugins: open a route in a new tab, a new window
 * or the split pane.
 *
 * @example
 * const { openInNewTab } = useWindowActions();
 * openInNewTab(`/_plugin/${pluginId}/cluster/${id}/resources`);
 */
export function useWindowActions(): WindowActions {
  const actions = React.useContext(WindowActionsContext);
  if (!actions) {
    throw new Error('useWindowActions must be used inside a workspace window (WindowActionsProvider)');
  }

  return actions;
}
