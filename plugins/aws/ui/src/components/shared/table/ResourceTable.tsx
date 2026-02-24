import React, { useState } from 'react';

import Box from '@mui/material/Box';
import TableSortLabel from '@mui/material/TableSortLabel';
import { styled } from '@mui/material/styles';
import { Text } from '@omniviewdev/ui/typography';
import { Alert, Skeleton } from '@omniviewdev/ui/feedback';

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

import ResourceTableBody from './ResourceTableBody'
import { useResources, DrawerComponent } from '@omniviewdev/runtime';
import { LuCircleAlert } from 'react-icons/lu';
import { plural } from '../../../utils/language';
import { DebouncedInput } from '../DebouncedInput';
import { getCommonPinningStyles } from './utils';
import { ColumnMeta } from './types';
import { useStoredState } from '../hooks/useStoredState';

export type Memoizer = string | string[] | ((data: any) => string);

const visibilityFromColumnDefs = (defs: Array<ColumnDef<any>>): VisibilityState => {
  const visibility: VisibilityState = {}
  defs.forEach((def) => {
    let meta = def?.meta as { defaultHidden?: boolean } || undefined
    if (meta === undefined) {
      meta = {}
    }
    if (def.id && meta?.defaultHidden !== undefined) {
      visibility[def.id] = !meta.defaultHidden
    }
  })
  return visibility
}

const TableWrapper = styled('div')`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--ov-border-default);
  border-radius: 4px;
  background-color: var(--ov-bg-base);
  overflow: hidden;
`

const ScrollContainer = styled('div')`
  flex: 1;
  overflow: scroll;
  overscroll-behavior: none;
  min-height: 0;
  &::-webkit-scrollbar {
    display: none;
  }
  scrollbar-width: none;
  -webkit-user-select: none;
`

const StyledTable = styled('table')`
  display: grid;
  width: 100%;
  border-collapse: collapse;
  -webkit-user-select: none;
`

export type Props<T = any> = {
  connectionID: string;
  resourceKey: string;
  columns: Array<ColumnDef<T> & ColumnMeta>;
  idAccessor: string;
  memoizer?: Memoizer;
  drawer?: DrawerComponent;
  onRowClick?: (id: string, data: any) => void;
};

const defaultData: any[] = []

const ResourceTableContainer: React.FC<Props> = ({
  connectionID,
  resourceKey,
  columns,
  idAccessor,
  memoizer,
  drawer,
  onRowClick,
}) => {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnVisibility, setColumnVisibility] = useStoredState<VisibilityState>(`aws-${connectionID}-${resourceKey}-column-visibility`, visibilityFromColumnDefs(columns));
  const [columnFilters, setColumnFilters] = useStoredState<ColumnFiltersState>(`aws-${connectionID}-${resourceKey}-column-filters`, []);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [search, setSearch] = useState<string>('');

  const { resources } = useResources({ pluginID: 'aws', connectionID, resourceKey, idAccessor });

  const table = useReactTable({
    data: resources.data?.result || defaultData,
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
      columnPinning: { left: ['select'], right: ['menu'] }
    },
  });

  const parentRef = React.useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;

  const placeHolderText = () => {
    const keyparts = resourceKey.split('::');
    const resource = plural(keyparts[keyparts.length - 1]);
    const count = resources.data?.result.length
    return `Search ${count ? `${count} ` : ''}${resource}...`;
  };

  if (resources.isError) {
    const errstring = resources.error?.toString();
    console.error('Failed loading resources', errstring);

    return (
      <Box
        sx={{
          display: 'flex',
          gap: 4,
          justifyContent: 'center',
          flexDirection: 'column',
          alignItems: 'center',
          height: '100%',
          width: '100%',
          userSelect: 'none',
        }}>
        <Alert
          color='error'
          size='lg'
          startAdornment={<LuCircleAlert size={20} />}
        >
          <Text weight="semibold" size="lg" color="error">
            Failed loading {resourceKey} resources
          </Text>
        </Alert>
        <Text size="sm" color="error" sx={{ textAlign: 'center', maxWidth: 500, flexWrap: 'wrap' }}>
          An error occurred while loading resources. Check your AWS credentials and region configuration.
        </Text>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', p: 0.75, gap: 0, minHeight: 0 }} >
      <TableWrapper>
        {/* Compact toolbar — outside scroll container so it never scrolls horizontally */}
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
          <DebouncedInput
            value={search ?? ''}
            onChange={value => {
              setSearch(String(value));
            }}
            placeholder={placeHolderText()}
          />
          <Box sx={{ flex: 1 }} />
        </Box>
        <ScrollContainer
          className={'table-container'}
          ref={parentRef}
        >
          <StyledTable
            aria-labelledby={'table-title'}
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
                  style={{ display: 'flex', width: '100%' }}
                >
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        overflow: 'hidden',
                        width: header.getSize(),
                        padding: '0px 8px',
                        height: 32,
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        color: 'var(--ov-fg-muted)',
                        backgroundColor: 'var(--ov-bg-surface)',
                        borderBottom: '1px solid var(--ov-border-default)',
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                        letterSpacing: '0.01em',
                        ...((header.column.columnDef.meta as { flex?: number | undefined })?.flex && {
                          minWidth: header.column.getSize(),
                          flex: (header.column.columnDef.meta as { flex?: number | undefined })?.flex
                        }),
                        ...getCommonPinningStyles(header.column, true)
                      }}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort()
                        ? <TableSortLabel
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
                        : flexRender(header.column.columnDef.header, header.getContext())
                      }
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            {resources.isLoading ? (
              <tbody style={{ display: 'grid' }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skel-${i}`} style={{ display: 'flex', width: '100%', height: 30 }}>
                    {table.getVisibleLeafColumns().map((col) => (
                      <td
                        key={col.id}
                        style={{
                          width: col.getSize(),
                          padding: '0px 8px',
                          borderBottom: '1px solid var(--ov-border-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          ...((col.columnDef.meta as { flex?: number | undefined })?.flex && {
                            minWidth: col.getSize(),
                            flex: (col.columnDef.meta as { flex?: number | undefined })?.flex,
                          }),
                        }}
                      >
                        <Skeleton variant="text" width="70%" sx={{ fontSize: '0.75rem' }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ) : (
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
            )}
          </StyledTable>
        </ScrollContainer>
      </TableWrapper>
    </Box>
  );
};

ResourceTableContainer.displayName = 'ResourceTableContainer';

export default ResourceTableContainer;
