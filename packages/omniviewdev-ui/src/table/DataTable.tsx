import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type ExpandedState,
} from '@tanstack/react-table';
import MuiTable from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import MuiCheckbox from '@mui/material/Checkbox';
import Box from '@mui/material/Box';
import TableSortLabel from '@mui/material/TableSortLabel';
import type { SxProps, Theme } from '@mui/material/styles';

import type { Density } from '../types';
import { Skeleton } from '../feedback';

export interface DataTableProps<T = any> {
  columns: ColumnDef<T, any>[];
  data: T[];
  density?: Density;
  loading?: boolean;
  error?: React.ReactNode;
  emptyState?: React.ReactNode;
  onRowClick?: (row: T) => void;
  selection?: 'none' | 'single' | 'multi';
  stickyHeader?: boolean;
  rowActions?: (row: T) => React.ReactNode;
  expandable?: boolean;
  renderDetail?: (row: T) => React.ReactNode;
  sx?: SxProps<Theme>;
}

const densityStyles: Record<string, { rowHeight: number; cellPy: number; cellPx: number }> = {
  compact: { rowHeight: 28, cellPy: 0.25, cellPx: 0.75 },
  comfortable: { rowHeight: 40, cellPy: 1, cellPx: 1.5 },
  spacious: { rowHeight: 56, cellPy: 2, cellPx: 2 },
};

export default function DataTable<T = any>({
  columns,
  data,
  density = 'comfortable',
  loading = false,
  error,
  emptyState,
  onRowClick,
  selection = 'none',
  stickyHeader = false,
  rowActions,
  expandable = false,
  renderDetail,
  sx,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const dStyles = densityStyles[density] || densityStyles.comfortable;

  const allColumns = useMemo(() => {
    const cols: ColumnDef<T, any>[] = [];

    if (selection === 'multi') {
      cols.push({
        id: '__select',
        header: ({ table }) => (
          <MuiCheckbox
            size="small"
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            sx={{ p: 0 }}
          />
        ),
        cell: ({ row }) => (
          <MuiCheckbox
            size="small"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            sx={{ p: 0 }}
          />
        ),
        size: 40,
      });
    }

    cols.push(...columns);

    if (rowActions) {
      cols.push({
        id: '__actions',
        header: '',
        cell: ({ row }) => rowActions(row.original),
        size: 60,
      });
    }

    return cols;
  }, [columns, selection, rowActions]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, rowSelection, expanded },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: expandable ? getExpandedRowModel() : undefined,
    enableRowSelection: selection !== 'none',
    enableMultiRowSelection: selection === 'multi',
  });

  if (error) {
    return <Box sx={{ p: 3 }}>{error}</Box>;
  }

  return (
    <Box sx={{ overflow: 'auto', ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}) }}>
      <MuiTable
        size="small"
        stickyHeader={stickyHeader}
        sx={{ '& td, & th': { py: dStyles.cellPy, px: dStyles.cellPx } }}
      >
        <TableHead>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableCell
                  key={header.id}
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: 'var(--ov-fg-muted)',
                    bgcolor: stickyHeader ? 'var(--ov-bg-surface)' : undefined,
                    whiteSpace: 'nowrap',
                    width: header.getSize(),
                  }}
                >
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <TableSortLabel
                      active={!!header.column.getIsSorted()}
                      direction={header.column.getIsSorted() === 'desc' ? 'desc' : 'asc'}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableSortLabel>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {allColumns.map((_, ci) => (
                  <TableCell key={ci}>
                    <Skeleton variant="text" width="80%" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            emptyState ? (
              <TableRow>
                <TableCell colSpan={allColumns.length} sx={{ textAlign: 'center', py: 4 }}>
                  {emptyState}
                </TableCell>
              </TableRow>
            ) : null
          ) : (
            table.getRowModel().rows.map((row) => (
              <>
                <TableRow
                  key={row.id}
                  hover
                  selected={row.getIsSelected()}
                  onClick={() => {
                    if (selection === 'single') {
                      row.toggleSelected(!row.getIsSelected());
                    }
                    if (expandable) {
                      row.toggleExpanded();
                    }
                    onRowClick?.(row.original);
                  }}
                  sx={{
                    cursor: onRowClick || expandable || selection === 'single' ? 'pointer' : undefined,
                    height: dStyles.rowHeight,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      sx={{ fontSize: '0.8125rem', color: 'var(--ov-fg-default)' }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
                {expandable && row.getIsExpanded() && renderDetail && (
                  <TableRow key={`${row.id}-detail`}>
                    <TableCell colSpan={allColumns.length} sx={{ bgcolor: 'var(--ov-bg-surface-inset)' }}>
                      {renderDetail(row.original)}
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))
          )}
        </TableBody>
      </MuiTable>
    </Box>
  );
}

DataTable.displayName = 'DataTable';
