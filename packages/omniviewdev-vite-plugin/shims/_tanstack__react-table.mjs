// Auto-generated shim for '@tanstack/react-table'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@tanstack/react-table'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@tanstack/react-table" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const ColumnFaceting = mod.ColumnFaceting;
export const ColumnFiltering = mod.ColumnFiltering;
export const ColumnGrouping = mod.ColumnGrouping;
export const ColumnOrdering = mod.ColumnOrdering;
export const ColumnPinning = mod.ColumnPinning;
export const ColumnSizing = mod.ColumnSizing;
export const ColumnVisibility = mod.ColumnVisibility;
export const GlobalFaceting = mod.GlobalFaceting;
export const GlobalFiltering = mod.GlobalFiltering;
export const Headers = mod.Headers;
export const RowExpanding = mod.RowExpanding;
export const RowPagination = mod.RowPagination;
export const RowPinning = mod.RowPinning;
export const RowSelection = mod.RowSelection;
export const RowSorting = mod.RowSorting;
export const _getVisibleLeafColumns = mod._getVisibleLeafColumns;
export const aggregationFns = mod.aggregationFns;
export const buildHeaderGroups = mod.buildHeaderGroups;
export const createCell = mod.createCell;
export const createColumn = mod.createColumn;
export const createColumnHelper = mod.createColumnHelper;
export const createRow = mod.createRow;
export const createTable = mod.createTable;
export const defaultColumnSizing = mod.defaultColumnSizing;
export const expandRows = mod.expandRows;
export const filterFns = mod.filterFns;
export const flattenBy = mod.flattenBy;
export const flexRender = mod.flexRender;
export const functionalUpdate = mod.functionalUpdate;
export const getCoreRowModel = mod.getCoreRowModel;
export const getExpandedRowModel = mod.getExpandedRowModel;
export const getFacetedMinMaxValues = mod.getFacetedMinMaxValues;
export const getFacetedRowModel = mod.getFacetedRowModel;
export const getFacetedUniqueValues = mod.getFacetedUniqueValues;
export const getFilteredRowModel = mod.getFilteredRowModel;
export const getGroupedRowModel = mod.getGroupedRowModel;
export const getMemoOptions = mod.getMemoOptions;
export const getPaginationRowModel = mod.getPaginationRowModel;
export const getSortedRowModel = mod.getSortedRowModel;
export const isFunction = mod.isFunction;
export const isNumberArray = mod.isNumberArray;
export const isRowSelected = mod.isRowSelected;
export const isSubRowSelected = mod.isSubRowSelected;
export const makeStateUpdater = mod.makeStateUpdater;
export const memo = mod.memo;
export const noop = mod.noop;
export const orderColumns = mod.orderColumns;
export const passiveEventSupported = mod.passiveEventSupported;
export const reSplitAlphaNumeric = mod.reSplitAlphaNumeric;
export const selectRowsFn = mod.selectRowsFn;
export const shouldAutoRemoveFilter = mod.shouldAutoRemoveFilter;
export const sortingFns = mod.sortingFns;
export const useReactTable = mod.useReactTable;

export default mod.default !== undefined ? mod.default : mod;
