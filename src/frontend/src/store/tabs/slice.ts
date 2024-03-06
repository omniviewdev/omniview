import { redistributeSpace } from '@/utils/math';
import { createSlice, nanoid } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { Tab, ContainerState, ReorderActionPayload } from './types'
import { findTabIndex, handleAddColumn, handleRemoveRow } from './helpers';

const initialState: ContainerState = {
  /** Start with no tabs open */
  tabs: [],
  /** Start with no windows open */
  windows: [],
  /** Start with a single row and column */
  layout: {
    rows: [window.innerHeight],
    columns: [window.innerWidth],
  },
}

// Slice
export const slice = createSlice({
  name: 'tabs',
  initialState,
  reducers: {

    /**
     * Adds a new tab to the state with more customizable options. The tab can optionally be assigned
     * to a window if a windowID is provided. The icon can be a blob, a link, or an inline data string.
     * The label can also be specified; if not, a default label is generated.
     *
     * @param state The current state of the container.
     * @param action The action payload containing the cluster context, optional windowID, icon, and label.
     */
    handleAddTab: (state, action: PayloadAction<{
      cluster: string,
      windowID?: string,
      icon?: string | Blob
      label?: string // Custom label
    }>) => {
      const { cluster, windowID, icon, label } = action.payload;

      // Generate a unique ID for the new tab
      const newTabId = nanoid();

      // Construct the new tab object with the provided icon and label or defaults
      const newTab: Tab = {
        id: newTabId,
        label: label || `Tab ${state.tabs.length + 1}`, // Use provided label or generate a default
        icon: icon || '', // Use provided icon or leave as an empty string
        cluster,
      };

      // Add the new tab to the tabs array
      state.tabs.push(newTab);

      // If a windowID is provided, validate its existence in the state
      if (windowID) {
        const windowExists = state.windows.some(window => window.id === windowID);
        if (!windowExists) {
          console.warn(`Window ID ${windowID} not found. The tab has been added but not linked to any window.`);
          // Here you can handle non-existent windowID as per your application's requirement
        }
      }
    },

    /**
     * Removes a tab and its associated window, if any, from the state. If the tab is linked to a window,
     * the window is also removed. This action ensures that the application's state remains consistent
     * without orphaned windows or tabs.
     *
     * @param state The current state of the container.
     * @param action The action payload containing the ID of the tab to be removed.
     */
    handleRemoveTab: (state, action: PayloadAction<string>) => {
      const tabId = action.payload;

      // Attempt to find the tab in the state
      const tabIndex = state.tabs.findIndex(tab => tab.id === tabId);
      if (tabIndex === -1) {
        console.warn(`Tab with ID ${tabId} not found.`);
        return; // Early return if the tab doesn't exist
      }

      // Remove the tab from the tabs array
      state.tabs.splice(tabIndex, 1);

      // Find any windows associated with this tab
      const associatedWindowIndex = state.windows.findIndex(window => window.tabId === tabId);
      if (associatedWindowIndex !== -1) {
        // If a window is associated with this tab, remove the window as well
        state.windows.splice(associatedWindowIndex, 1);

        // After removing a window, you might need to adjust the layout or other windows
        // depending on your application's layout management logic.
        // This could include resizing remaining windows, adjusting grid positions, etc.
        // Here, implement any necessary logic to maintain the layout integrity after a window removal.
        // For example:
        // adjustLayoutAfterWindowRemoval(state, state.windows[associatedWindowIndex].position);
      }
    },


    /**
     * Reorders a tab in the tab list, moving it from its old position to a new position.
     * This is used to reflect changes in the tab order made by the user in the UI.
     * 
     * @param state The current state of the container.
     * @param action The action payload containing the id of the tab to move, its old position, and new position.
     */
    handleReorderTab: (state, action: PayloadAction<{ id: string, oldPosition: number, newPosition: number }>) => {
      const { id, oldPosition, newPosition } = action.payload;

      // Check if oldPosition or newPosition are out of bounds
      if (oldPosition < 0 || oldPosition >= state.tabs.length || newPosition < 0 || newPosition >= state.tabs.length) {
        console.warn("Old position or new position is out of bounds.");
        return;
      }

      // Find the tab to reorder
      const tabToMove = state.tabs.find(tab => tab.id === id);
      if (!tabToMove) {
        console.warn(`Tab with ID ${id} not found.`);
        return;
      }

      // Remove the tab from its current position
      state.tabs.splice(oldPosition, 1);

      // Adjust newPosition if the tab is moved forward, as the array length decreases by one after removal
      const adjustedNewPosition = newPosition > oldPosition ? newPosition - 1 : newPosition;

      // Insert the tab at its new position
      state.tabs.splice(adjustedNewPosition, 0, tabToMove);
    },

    /**
     * Reorders tabs based on a strategy ('swap' or 'shift').
     *
     * @param state The current state of the container.
     * @param action The action payload containing the IDs of the tabs to reorder and the strategy.
     */
    handleReorderTabsByID: (state, action: PayloadAction<ReorderActionPayload>) => {
      const { tabId1, tabId2, strategy } = action.payload;

      const index1 = findTabIndex(state.tabs, tabId1);
      const index2 = findTabIndex(state.tabs, tabId2);

      // Ensure both tabs are found
      if (index1 === -1 || index2 === -1) {
        console.warn(`One or both tabs not found. IDs: ${tabId1}, ${tabId2}`);
        return;
      }

      if (strategy === 'swap') {
        // Swap the two tabs
        [state.tabs[index1], state.tabs[index2]] = [state.tabs[index2], state.tabs[index1]];
      } else if (strategy === 'shift') {
        // Shift the tabs
        const itemToMove = state.tabs.splice(index1, 1)[0];
        state.tabs.splice(index2, 0, itemToMove);
      } else {
        console.warn(`Unknown reorder strategy: ${strategy}`);
      }
    },

    /**
     * Manually updates the layout state with the new column sizes. Useful when committing a drag handler
     * for resizing columns in the layout.
     * 
     * @param state The current state of the container.
     * @param action The action payload containing an array of new sizes for the columns.
     */
    handleResizeColumns: (state, action: PayloadAction<number[]>) => {
      const newColumnSizes = action.payload;

      // Validate the new sizes to ensure they are not empty
      if (newColumnSizes.length !== state.layout.columns.length) {
        console.warn("Column sizes array must match the number of columns in the layout.");
        return;
      }
      if (newColumnSizes.some(size => size <= 0)) {
        console.warn("Column sizes must be positive numbers.");
        return;
      }

      // Update the columns array in the layout
      state.layout.columns = newColumnSizes;
    },

    /**
     * Manually updates the layout state with the new row sizes. Useful when committing a drag handler
     * for resizing rows in the layout.
     * 
     * @param state The current state of the container.
     * @param action The action payload containing an array of new sizes for the rows.
     */
    handleResizeRows: (state, action: PayloadAction<number[]>) => {
      const newRowSizes = action.payload;

      // Validate the new sizes to ensure they are not empty
      if (newRowSizes.length !== state.layout.rows.length) {
        console.warn("Row sizes array must match the number of rows in the layout.");
        return;
      }
      if (newRowSizes.some(size => size <= 0)) {
        console.warn("Row sizes must be positive numbers.");
        return;
      }
      // Update the rows array in the layout
      state.layout.rows = newRowSizes;
    },


    /** 
     * Adds a new column to the layout, providing a row and column index for where to position the element 
     * If the row or column index is out of range, the row or column is added to the end of the layout and 
     * the windows are repositioned accordingly.
     */
    handleAddWindow: (
      state,
      action: PayloadAction<{
        tabId: string,
        row: number,
        redistribution?: 'even' | 'priority',
        priorities?: 'first' | 'last' | number[],
      }>
    ) => {
      const { tabId, row, redistribution = 'even', priorities = [] } = action.payload;
      const windowId = nanoid();

      // our width to start should be the average of the current column widths
      const newColumnWidth = Math.floor(state.layout.columns.reduce((acc, val) => acc + val, 0) / state.layout.columns.length)

      // Ensure the tab isn't already assigned to a window
      if (state.windows.some(w => w.tabId === tabId)) {
        console.warn(`tab ${tabId} is already assigned to a window.`);
        return;
      }

      // Add the the new column
      const results = handleAddColumn(state.layout.columns, state.windows, row, newColumnWidth, redistribution, priorities);
      state.layout.columns = results.columns;
      state.windows = results.windows;
      state.windows.push({
        id: windowId,
        tabId,
        position: {
          rowStart: row,
          rowEnd: row + 1, // new windows should take up a single row height
          columnStart: state.layout.columns.length - 1,
          columnEnd: state.layout.columns.length, // Assume single column width for new window, adjust if necessary
        }
      });
    },

    /** 
     * Removes a window from the layout, given a window id, and resizes element to take up the missing space.
     * If the window results in a row or column no longer being needed, the row or column is removed from the layout
     * and the windows are repositioned accordingly.
     */
    handleRemoveWindow: (
      state,
      action: PayloadAction<{
        id: string,
        idType?: 'tab' | 'window'
        redistribution?: 'even' | 'priority',
        priorities?: 'first' | 'last' | number[],
      }>
    ) => {
      const { id, idType = 'window', redistribution = 'even', priorities = [] } = action.payload;

      // Find and remove the specified window
      const windowIndex = idType === 'window'
        ? state.windows.findIndex(window => window.id === id)
        : state.windows.findIndex(window => window.tabId === id);

      if (windowIndex === -1) {
        console.warn(`Window with id ${window} not found.`);
        return;
      }

      // Record the window's row and column for later checks
      const { rowStart, columnStart, columnEnd } = state.windows[windowIndex].position;

      // clear any empty rows or columns and resize the one that was affected, and do any resizing of other windows
      // for example, say we have the following layout:
      //
      // -----------------
      // |   1   |   2   |
      // -----------------
      // |   3   |   4   |
      // -----------------
      //
      // if we remove window 2, we should end up with the following layout:
      // -----------------
      // |       1       |
      // -----------------
      // |   3   |   4   |
      // -----------------
      //
      // this effected the first column, so we need to recalculate the width of the items in the first column. 
      // Now let's say we now remove window 1, we would end up with the following layout:
      //
      // -----------------
      // |       |       |
      // |   3   |   4   |
      // |       |       |
      // -----------------
      //
      // the first row is now empty, so we should remove it from the layout and recalculate the height of the items
      // in the other rows to fill the space.
      //
      // so, logic is:
      // 1. remove the window
      state.windows.splice(windowIndex, 1);

      let rowRemoved = false;

      // 2. resize the window before or after the column was affected
      if (columnStart === 1 && columnEnd === state.layout.columns.length) {

        // if the window was the only one in the row, remove the row
        state.layout.rows.splice(rowStart - 1, 1);
      } else {

        // if the window was the first in the row, find the window after it and make it start in the original rows start position
        // otherwise, find the window before it and make it end in the original rows end
        // if there are no windows before or after, just remove the row
        state.windows.forEach(window => {
          if (columnStart > 1 && window.position.columnStart === columnEnd && rowStart === window.position.rowStart) {
            // resize the window in the same row
            window.position.columnStart = columnStart;
            return;
          }
          if (columnEnd < state.layout.columns.length && window.position.columnEnd === columnStart && rowStart === window.position.rowStart) {
            // resize the window in the same row
            window.position.columnEnd = columnEnd;
            return;
          }
        })
      }

      // 3. windows are all processed. Now we need to resize the row heights if there was a removal of a row
      if (rowRemoved) {
        let result = handleRemoveRow(state.layout.rows, state.windows, rowStart, redistribution, priorities);
        state.layout.rows = result.rows;
        state.windows = result.windows;
      }
    },

    /** 
     * Assigns a tab to a window given a tab id and a window id, and then unassigns the currently 
     * assigned tab from the window
     */
    handleAssignTabToWindow: (state, action: PayloadAction<{ tabId: string, windowID: string }>) => {
      // Find the window 
      const windowIndex = state.windows.findIndex(window => window.id === action.payload.windowID);
      if (windowIndex === -1) {
        console.warn(`window with id ${action.payload.windowID} not found.`);
        return;
      }

      if (state.windows[windowIndex].tabId === action.payload.tabId) {
        console.warn(`tab with id ${action.payload.tabId} is already assigned to window with id ${action.payload.windowID}.`);
        return;
      }

      // find the tab we're assigning, so that if it's already assigned to a window, we can swap the window assignments,
      // this is useful for when we want to move a tab from one window to another without having to remove it from the first window
      const tabToAssignIndex = state.tabs.findIndex(tab => tab.id === action.payload.tabId);
      if (tabToAssignIndex === -1) {
        console.warn(`tab with id ${action.payload.tabId} not found.`);
        return;
      }

      // if the tab we're assigning is already assigned to a window, we'll give that window to the tab that's 
      // being unassigned from the window
      //
      // so, first go through the windows to see if any of them are assigned to the tab we're assigning
      const currentWindowIndex = state.windows.findIndex(window => window.tabId === action.payload.tabId);
      if (currentWindowIndex !== -1) {
        // if we found a window assigned to the tab, we'll assign it to the window we're assigning the tab to
        state.windows[currentWindowIndex].tabId = state.windows[windowIndex].tabId;
      }

      // now assign the tab to the new window
      state.windows[windowIndex].tabId = action.payload.tabId;
    },

    /**
     * Handle the browser window resizing event, and updates the layout state with the new window dimensions
     */
    handleBrowserResize: (state, action: PayloadAction<{ width: number, height: number }>) => {
      state.layout.rows = redistributeSpace(state.layout.rows, action.payload.width, 'even');
      state.layout.columns = redistributeSpace(state.layout.columns, action.payload.height, 'even');
    },
  },
})

// Action creators are generated for each case reducer function
export const {
  handleAddTab,
  handleRemoveTab,
  handleReorderTab,
  handleReorderTabsByID,
  handleAssignTabToWindow,
  handleAddWindow,
  handleRemoveWindow,
  handleResizeRows,
  handleResizeColumns,
  handleBrowserResize
} = slice.actions

export default slice.reducer
