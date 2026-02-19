import React, { useState, useMemo, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table';
import Box from '@mui/material/Box';
import MuiCheckbox from '@mui/material/Checkbox';
import TableSortLabel from '@mui/material/TableSortLabel';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import type { SxProps, Theme } from '@mui/material/styles';

import { Skeleton } from '../feedback';

export interface IDETableProps<T = any> {
  /** TanStack column definitions */
  columns: ColumnDef<T, any>[];
  /** Row data */
  data: T[];
  /** Row height in pixels */
  rowHeight?: number;
  /** Whether to show checkboxes for row selection */
  selection?: boolean;
  /** Selected row IDs (controlled) */
  selectedRows?: RowSelectionState;
  /** Selection change handler */
  onSelectionChange?: (selection: RowSelectionState) => void;
  /** Called when a row is clicked */
  onRowClick?: (row: T) => void;
  /** Render actions column cell (e.g. "..." menu) */
  rowActions?: (row: T) => React.ReactNode;
  /** Whether to show the built-in search bar */
  searchable?: boolean;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Controlled search value */
  searchValue?: string;
  /** Search change callback */
  onSearchChange?: (value: string) => void;
  /** Toolbar content rendered to the right of the search bar */
  toolbar?: React.ReactNode;
  /** Count label: e.g. "11 Pods" */
  countLabel?: string;
  /** Whether the table is loading */
  loading?: boolean;
  /** Number of skeleton rows to show */
  skeletonRows?: number;
  /** Empty state content */
  emptyState?: React.ReactNode;
  /** Sticky header */
  stickyHeader?: boolean;
  /** Style overrides */
  sx?: SxProps<Theme>;
}

export default function IDETable<T = any>({
  columns,
  data,
  rowHeight = 30,
  selection = false,
  selectedRows: controlledSelection,
  onSelectionChange,
  onRowClick,
  rowActions,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchValue: controlledSearchValue,
  onSearchChange,
  toolbar,
  countLabel,
  loading = false,
  skeletonRows = 8,
  emptyState,
  stickyHeader = true,
  sx,
}: IDETableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalSelection, setInternalSelection] = useState<RowSelectionState>({});
  const [internalSearch, setInternalSearch] = useState('');

  const rowSelection = controlledSelection ?? internalSelection;
  const setRowSelection = onSelectionChange ?? setInternalSelection;
  const searchValue = controlledSearchValue ?? internalSearch;
  const setSearchValue = onSearchChange ?? setInternalSearch;

  const allColumns = useMemo(() => {
    const cols: ColumnDef<T, any>[] = [];

    if (selection) {
      cols.push({
        id: '__select',
        header: ({ table }) => (
          <MuiCheckbox
            size="small"
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            sx={{ p: 0, color: 'var(--ov-fg-faint)', '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: 'var(--ov-accent-fg)' } }}
          />
        ),
        cell: ({ row }) => (
          <MuiCheckbox
            size="small"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            sx={{ p: 0, color: 'var(--ov-fg-faint)', '&.Mui-checked': { color: 'var(--ov-accent-fg)' } }}
          />
        ),
        size: 32,
        enableSorting: false,
      });
    }

    cols.push(...columns);

    if (rowActions) {
      cols.push({
        id: '__actions',
        header: '',
        cell: ({ row }) => (
          <Box onClick={(e) => e.stopPropagation()}>
            {rowActions(row.original)}
          </Box>
        ),
        size: 36,
        enableSorting: false,
      });
    }

    return cols;
  }, [columns, selection, rowActions]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, rowSelection, globalFilter: searchValue },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection as any,
    onGlobalFilterChange: setSearchValue,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableRowSelection: selection,
    enableMultiRowSelection: selection,
  });

  const handleRowClick = useCallback((row: T) => {
    onRowClick?.(row);
  }, [onRowClick]);

  const headerHeight = rowHeight + 2;
  const cellPx = '8px';
  const cellPy = '0px';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        bgcolor: 'var(--ov-bg-base)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Search / Toolbar bar */}
      {(searchable || toolbar || countLabel) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1,
            py: 0.5,
            borderBottom: '1px solid var(--ov-border-default)',
            bgcolor: 'var(--ov-bg-surface)',
            flexShrink: 0,
          }}
        >
          {searchable && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flex: 1,
                maxWidth: 360,
                height: 28,
                border: '1px solid var(--ov-border-default)',
                borderRadius: '4px',
                bgcolor: 'var(--ov-bg-base)',
                px: 0.75,
                '&:focus-within': { borderColor: 'var(--ov-accent)' },
              }}
            >
              <SearchIcon sx={{ fontSize: 14, color: 'var(--ov-fg-faint)', mr: 0.5 }} />
              <InputBase
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={countLabel ? `Search ${countLabel}...` : searchPlaceholder}
                sx={{
                  flex: 1,
                  fontSize: '0.75rem',
                  color: 'var(--ov-fg-default)',
                  '& input': { py: 0, px: 0 },
                  '& input::placeholder': { color: 'var(--ov-fg-faint)', opacity: 1 },
                }}
              />
            </Box>
          )}
          {!searchable && countLabel && (
            <Typography sx={{ fontSize: '0.75rem', color: 'var(--ov-fg-muted)', fontWeight: 500 }}>
              {countLabel}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {toolbar}
        </Box>
      )}

      {/* Table */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--ov-font-ui)',
            fontSize: '0.75rem',
            tableLayout: 'fixed',
          }}
        >
          {/* Column widths */}
          <colgroup>
            {table.getAllColumns().map((col) => (
              <col key={col.id} style={{ width: col.getSize() !== 150 ? col.getSize() : undefined }} />
            ))}
          </colgroup>

          {/* Header */}
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                style={{
                  height: headerHeight,
                  ...(stickyHeader ? { position: 'sticky', top: 0, zIndex: 2 } as React.CSSProperties : {}),
                }}
              >
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{
                      padding: `${cellPy} ${cellPx}`,
                      textAlign: 'left',
                      fontWeight: 600,
                      fontSize: '0.6875rem',
                      color: 'var(--ov-fg-muted)',
                      backgroundColor: 'var(--ov-bg-surface)',
                      borderBottom: '1px solid var(--ov-border-default)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      userSelect: 'none',
                      letterSpacing: '0.01em',
                    }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <TableSortLabel
                        active={!!header.column.getIsSorted()}
                        direction={header.column.getIsSorted() === 'desc' ? 'desc' : 'asc'}
                        onClick={header.column.getToggleSortingHandler()}
                        sx={{
                          fontSize: 'inherit',
                          fontWeight: 'inherit',
                          color: 'inherit !important',
                          '& .MuiTableSortLabel-icon': { fontSize: 12, opacity: 0.5 },
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </TableSortLabel>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {/* Body */}
          <tbody>
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`skel-${i}`} style={{ height: rowHeight }}>
                  {allColumns.map((_, ci) => (
                    <td
                      key={ci}
                      style={{
                        padding: `${cellPy} ${cellPx}`,
                        borderBottom: '1px solid var(--ov-border-muted)',
                      }}
                    >
                      <Skeleton variant="text" width="70%" sx={{ fontSize: '0.75rem' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={allColumns.length}
                  style={{ textAlign: 'center', padding: '32px 8px', color: 'var(--ov-fg-faint)' }}
                >
                  {emptyState ?? (
                    <Typography sx={{ fontSize: '0.75rem', color: 'var(--ov-fg-faint)' }}>
                      No items to display
                    </Typography>
                  )}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => handleRowClick(row.original)}
                  style={{
                    height: rowHeight,
                    cursor: onRowClick ? 'pointer' : undefined,
                    backgroundColor: row.getIsSelected()
                      ? 'var(--ov-accent-subtle)'
                      : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (!row.getIsSelected()) {
                      e.currentTarget.style.backgroundColor = 'var(--ov-state-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = row.getIsSelected()
                      ? 'var(--ov-accent-subtle)'
                      : '';
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: `${cellPy} ${cellPx}`,
                        fontSize: '0.75rem',
                        color: 'var(--ov-fg-default)',
                        borderBottom: '1px solid var(--ov-border-muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: `${rowHeight}px`,
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Box>
    </Box>
  );
}

IDETable.displayName = 'IDETable';
