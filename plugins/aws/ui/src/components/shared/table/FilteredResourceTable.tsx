import React, { useState, useMemo } from 'react';

import {
  Box,
  Link,
  Sheet,
  Stack,
  Table,
  styled,
} from '@mui/joy';

import { ArrowDropDown } from '@mui/icons-material';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import get from 'lodash.get';

import ResourceTableBody from './ResourceTableBody';
import { useResources, DrawerComponent } from '@omniviewdev/runtime';
import { DebouncedInput } from '../DebouncedInput';
import { getCommonPinningStyles } from './utils';
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

const TableContainer = styled(Sheet)(
  ({}) => `
  background-color: inherit;
  width: 100%;
  border-radius: 4px;
  flex: 1;
  overflow: scroll;
  overscroll-behavior: none;
  min-height: 0;
  &::-webkit-scrollbar {
    display: none;
  }
  scrollbar-width: none;
  -webkit-user-select: none;
`,
)

const StyledTable = styled(Table)(
  ({}) => `
  display: grid;
  --TableCell-headBackground: var(--joy-palette-background-level1);
  --Table-headerUnderlineThickness: 1px;
  --TableRow-hoverBackground: var(--joy-palette-background-level2);
  --TableCell-paddingY: 0px;
  --TableCell-paddingX: 8px;
  -webkit-user-select: none;
`,
)

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

  const table = useReactTable({
    data: filteredData,
    columns,
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

  const parentRef = React.useRef<HTMLDivElement>(null);

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', p: 0.75, gap: 0.75, minHeight: 0 }}>
      <Stack direction='row' justifyContent='space-between' sx={{ width: '100%' }}>
        <DebouncedInput
          value={search ?? ''}
          onChange={(value: string | number) => setSearch(String(value))}
          placeholder={`Search ${filteredData.length} items...`}
        />
      </Stack>
      <TableContainer
        className='table-container'
        variant='outlined'
        ref={parentRef}
      >
        <StyledTable
          aria-labelledby='table-title'
          stickyHeader
          borderAxis='x'
          hoverRow
          size='sm'
        >
          <thead
            style={{
              display: 'grid',
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}
          >
            {table.getHeaderGroups().map(headerGroup => (
              <tr
                key={headerGroup.id}
                style={{ display: 'flex', width: '100%', cursor: 'pointer' }}
              >
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      alignContent: 'center',
                      display: 'flex',
                      alignItems: 'center',
                      overflow: 'hidden',
                      width: header.getSize(),
                      ...((header.column.columnDef.meta as { flex?: number })?.flex && {
                        minWidth: header.column.getSize(),
                        flex: (header.column.columnDef.meta as { flex?: number })?.flex,
                      }),
                      ...getCommonPinningStyles(header.column, true),
                    }}
                  >
                    {header.column.getCanSort()
                      ? <Link
                        underline='none'
                        color='primary'
                        component='button'
                        fontWeight='lg'
                        endDecorator={header.column.getIsSorted() && <ArrowDropDown />}
                        sx={{
                          '& svg': {
                            transition: '0.2s',
                            transform:
                              header.column.getIsSorted() as string === 'desc' ? 'rotate(180deg)' : 'rotate(0deg)',
                          },
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </Link>
                      : flexRender(header.column.columnDef.header, header.getContext())
                    }
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <ResourceTableBody
            table={table}
            tableContainerRef={parentRef}
            connectionID={connectionID}
            resourceKey={resourceKey}
            columnVisibility={JSON.stringify({ columnVisibility })}
            rowSelection={rowSelection}
            drawer={drawer}
            memoizer={memoizer}
            onRowClick={onRowClick}
          />
        </StyledTable>
      </TableContainer>
    </Box>
  );
};

FilteredResourceTable.displayName = 'FilteredResourceTable';

export default FilteredResourceTable;
