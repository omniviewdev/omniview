/**
 * A tab represents a single viewable pane within the tab bar. Each tab is linked to a single
 * cluster context for displaying the tab's content. The tab is also linked to a window ID, which
 * is used to render the tab's content in the main rendering container.
 */
export interface Tab {
  /** Unique id for the tab */
  id: string;
  /** Label to display in the tab */
  label: string;
  /** Icon to display in the tab */
  icon: string | Blob | React.ReactNode;
  /** The cluster context the tab is using */
  cluster: string;
}

export interface GridPosition {
  /** The row to start the window at */
  rowStart: number;
  /** The row to end the window at */
  rowEnd: number;
  /** The column to start the window at */
  columnStart: number;
  /** The column to end the window at */
  columnEnd: number;
}

/** 
 * Layout represents the current layout of the windows in the main rendering container 
 */
export interface Layout {
  /** An array of sizings in pixels for each row, with each index being the row number */
  rows: number[];
  /** An array of sizings in pixels for each column, with each index being the column number */
  columns: number[];
}

/** 
 * A window represents a single viewable pane within the main rendering container. Each
 * is linked to a single tab and it's context for displaying the tab's content.
 * To acheive the layout, we use CSS Grid to position the windows within the main
 * rendering container.
 */
export interface Window {
  /** The ID of the window */
  id: string;
  /** The ID of the tab this window is rendering */
  tabId: string;
  /** The position of the window within the grid */
  position: GridPosition;
}

/**
 * The current state of the application container, including the tabs, windows, and layout
 * of the main rendering container.
 */
export interface ContainerState {
  /** The current tabs that are opened, both assigned and unassigned to windows */
  tabs: Tab[];
  /** The various windows within the main rendering container */
  windows: Window[];
  /** The layout of the windows in the main rendering container */
  layout: Layout;
}

/**
  * Reorder tabs within the tab bar. If the strategy is 'swap', the two tabs will swap positions
  * within the tab bar. If the strategy is 'shift', tabs will shift positions to accomodate the
  * new tabs position.
  */
export type ReorderActionPayload = {
  tabId1: string;
  tabId2: string;
  strategy: 'swap' | 'shift';
};

