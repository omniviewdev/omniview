import { redistributeSpace } from '@/utils/math';
import type { Tab, Window } from './types';

/**
 * Removes a column from the layout, and optionally redistributes the space to remaining columns.
 *
* @param columns The array of column widths.
* @param windows The array of windows.
* @param columnIndex The index of the column to remove.
* @param redistribution The redistribution strategy to use. Can be 'even' or 'priority'.
* @param priorities The priority indexes (or location psuedonym) to use when redistributing space. Only used if redistribution is 'priority'.
 */
export const handleRemoveColumn = (
  columns: number[],
  windows: Window[],
  columnIndex: number,
  redistribution: 'even' | 'priority',
  priorities: 'first' | 'last' | number[],
): { columns: number[]; windows: Window[] } => {
  if (columnIndex < 0 || columnIndex >= columns.length) {
    console.warn('invalid column index');
    return { columns, windows };
  }

  // Work on a copy
  let newColumns = columns.slice();
  const newWindows = windows.slice();

  // Calculate the current total width to preserve it after removing the targeted column
  const widthBeforeRemoval = newColumns.reduce((acc, val) => acc + val, 0);

  // Remove the specified column
  newColumns.splice(columnIndex, 1);

  // Redistribute space amongs remaining columns
  newColumns = redistributeSpace(
    newColumns,
    widthBeforeRemoval,
    redistribution,
    priorities,
  );

  // Remove or adjust windows that were in the removed column
  newWindows.forEach(window => {
    if (window.position.columnStart > columnIndex) {
      // Adjust windows that were positioned after the removed column
      window.position.columnStart -= 1;
      window.position.columnEnd -= 1;
    } else if (window.position.columnStart === columnIndex || window.position.columnEnd === columnIndex) {
      // Handle windows that were in the removed column
      // For simplicity, let's remove these windows. Alternatively, you could adjust their positions based on your app's needs.
      const windowIndex = newWindows.findIndex(w => w.id === window.id);
      if (windowIndex !== -1) {
        newWindows.splice(windowIndex, 1);
      }
    }
  });

  // Return the updated columns and windows
  return { columns: newColumns, windows: newWindows };
};

/**
 * Removes a row from the layout, and redistributes the space to remaining rows according to the specified strategy.
 *
 * @param state The current state of the container.
 * @param action The action payload containing the index of the row to remove and the redistribution strategy.
 */

export const handleRemoveRow = (
  rows: number[],
  windows: Window[],
  index: number,
  redistribution: 'even' | 'priority',
  priorities: 'first' | 'last' | number[],
): { rows: number[]; windows: Window[] } => {
  if (index < 0 || index >= rows.length) {
    console.warn('invalid row index');
    return { rows, windows };
  }

  // Work on a copy
  let newRows = rows.slice();
  const newWindows = windows.slice();

  // Calculate the total height of all rows before removing the targeted row
  const heightBeforeRemoval = newRows.reduce((acc, val) => acc + val, 0);

  // Remove the specified row
  newRows.splice(index, 1);

  // Redistribute space among remaining rows based on the specified strategy
  // The target height is the totalHeightBeforeRemoval, aiming to keep the overall layout height unchanged
  newRows = redistributeSpace(
    newRows,
    heightBeforeRemoval,
    redistribution,
    priorities,
  );

  // Adjust windows that are positioned in or below the removed row
  newWindows.forEach(window => {
    if (window.position.rowStart > index) {
      // Shift up windows below the removed row
      window.position.rowStart -= 1;
      window.position.rowEnd -= 1;
    } else if (window.position.rowStart === index) {
      // For windows that start in the removed row, adjust their position.
      // this just moves them up for now, but other strategies could be applied.
      window.position.rowStart = Math.max(0, index - 1);
      window.position.rowEnd = Math.max(1, window.position.rowEnd - 1);
    }
  });

  return { rows: newRows, windows: newWindows };
};

/**
 * Adds a row to the layout, and redistributes the space to accommodate the new row according to the specified strategy.
 *
 * @param rows The array of row heights.
 * @param windows The array of windows.
 * @param newRowHeight The height of the new row to add.
 * @param rowIndex The index at which to add the new row.
 * @param redistribution The redistribution strategy to use. Can be 'even' or 'priority'.
 * @param priorities The priority indexes (or location psuedonym) to use when redistributing space. Only used if redistribution is 'priority'.
 * @returns The updated rows and windows.
 */
export const handleAddRow = (
  rows: number[],
  windows: Window[],
  newRowHeight: number,
  rowIndex: number,
  redistribution: 'even' | 'priority',
  priorities?: 'first' | 'last' | number[],
): { rows: number[]; windows: Window[] } => {
  let newRows = rows.slice();
  const newWindows = windows.slice();

  // Get the current height so we keep the same height after adding the new row
  const currentHeight = newRows.reduce((acc, val) => acc + val, 0);

  // Insert the new row at the specified index
  newRows.splice(rowIndex, 0, newRowHeight);

  // Redistribute space among all rows to adjust to the new total height
  newRows = redistributeSpace(
    newRows,
    currentHeight,
    redistribution,
    priorities,
  );

  // Adjust windows that are positioned at or below the added row
  newWindows.forEach(window => {
    if (window.position.rowStart >= rowIndex) {
      // Shift down windows at or below the added row
      window.position.rowStart += 1;
      window.position.rowEnd += 1;
    }
  });

  return { rows: newRows, windows: newWindows };
};

/**
 * Adds a column to the layout, and redistributes the space among existing columns to maintain the overall layout width.
 *
 * @param columns The array of column widths.
 * @param windows The array of windows.
 * @param newRowHeight The height of the new column to add.
 * @param rowIndex The index at which to add the new column.
 * @param redistribution The redistribution strategy to use. Can be 'even' or 'priority'.
 * @param priorities The priority indexes (or location psuedonym) to use when redistributing space. Only used if redistribution is 'priority'.
 * @returns The updated columns and windows.
 */
export const handleAddColumn = (
  columns: number[],
  windows: Window[],
  newColumnWidth: number,
  columnIndex: number,
  redistribution: 'even' | 'priority',
  priorities?: 'first' | 'last' | number[],
): { columns: number[]; windows: Window[] } => {
  let newColumns = columns.slice();
  const newWindows = windows.slice();

  // Calculate the current total width to preserve it after adding the new column
  const targetTotalWidth = newColumns.reduce((acc, val) => acc + val, 0);

  // Insert the new column width at the specified index
  newColumns.splice(columnIndex, 0, newColumnWidth);

  // After inserting the new column, the total width exceeds the target by the width of the new column
  // We need to adjust the widths of all columns (including the new one) to match the original total width
  newColumns = redistributeSpace(
    newColumns,
    targetTotalWidth,
    redistribution,
    priorities,
  );

  // Adjust windows that are positioned at or beyond the added column
  newWindows.forEach(window => {
    if (window.position.columnStart >= columnIndex) {
      // Shift right windows at or beyond the added column
      window.position.columnStart += 1;
      window.position.columnEnd += 1;
    }
  });

  return { columns: newColumns, windows: newWindows };
};

/**
 * Finds the index of a tab by its ID.
 * @param tabs The array of tabs.
 * @param tabId The ID of the tab to find.
 * @returns The index of the tab or -1 if not found.
 */
export const findTabIndex = (tabs: Tab[], tabId: string) => tabs.findIndex(tab => tab.id === tabId);

