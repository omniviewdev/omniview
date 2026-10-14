import React, { useState, useMemo } from 'react';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import get from 'lodash.get';

import ResourceTableFrame from './ResourceTableFrame';
import { useResources, DrawerComponent } from '@omniviewdev/runtime';
import { withFlexSizing } from './utils';
import { ColumnMeta, Memoizer } from './types';

export type Props<T = any> = {
  connectionID: string;
  resourceKey: string;
  columns: Array<ColumnDef<T> & ColumnMeta>;
  idAccessor: string;
  filterFn: (item: any) => boolean;
  memoizer?: Memoizer;
  drawer?: DrawerComponent;
  onRowClick?: (id: string, data: any) => void;
};

const defaultData: any[] = [];

const FilteredResourceTable: React.FC<Props> = ({
  connectionID,
  resourceKey,
  columns,
  idAccessor,
  filterFn,
  memoizer,
  drawer,
  onRowClick,
}) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [search, setSearch] = useState<string>('');

  const { resources } = useResources({ pluginID: 'aws', connectionID, resourceKey, idAccessor });

  const filteredData = useMemo(
    () => (resources.data?.result || defaultData).filter(filterFn),
    [resources.data?.result, filterFn],
  );

  const sizedColumns = useMemo(() => withFlexSizing(columns), [columns]);

  const table = useReactTable({
    data: filteredData,
    columns: sizedColumns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => get(row, idAccessor),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: search,
      columnPinning: { left: ['select'], right: ['menu'] },
    },
  });

  return (
    <ResourceTableFrame
      table={table}
      isLoading={resources.isLoading}
      search={search}
      onSearchChange={(value) => setSearch(String(value))}
      searchPlaceholder={`Search ${filteredData.length} items...`}
      connectionID={connectionID}
      resourceKey={resourceKey}
      columnVisibility={columnVisibility}
      rowSelection={rowSelection}
      drawer={drawer}
      memoizer={memoizer}
      onRowClick={onRowClick}
    />
  );
};

FilteredResourceTable.displayName = 'FilteredResourceTable';

export default FilteredResourceTable;
