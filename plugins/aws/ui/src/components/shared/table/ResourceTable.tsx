import React, { useState } from 'react';

import {
  Alert,
  Box,
  Link,
  Sheet,
  Stack,
  Table,
  Typography,
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

const TableContainer = styled(Sheet)(
  ({ }) => `
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
  ({ }) => `
  display: grid;
  --TableCell-headBackground: var(--joy-palette-background-level1);
  --Table-headerUnderlineThickness: 1px;
  --TableRow-hoverBackground: var(--joy-palette-background-level2);
  --TableCell-paddingY: 0px;
  --TableCell-paddingX: 8px;
  -webkit-user-select: none;
`,
)

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

  const parentRef = React.useRef<HTMLDivElement>(null);

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
          variant='soft'
          size='lg'
          startDecorator={<LuCircleAlert size={20} />}
          color='danger'
        >
          <Typography level='title-lg' color='danger'>
            Failed loading {resourceKey} resources
          </Typography>
        </Alert>
        <Typography level='body-sm' color='danger' textAlign={'center'} maxWidth={500} flexWrap='wrap'>
          An error occurred while loading resources. Check your AWS credentials and region configuration.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', p: 0.75, gap: 0.75, minHeight: 0 }} >
      <Stack direction='row' justifyContent={'space-between'} className='SearchBar' sx={{ width: '100%' }}>
        <DebouncedInput
          value={search ?? ''}
          onChange={value => {
            setSearch(String(value));
          }}
          placeholder={placeHolderText()}
        />
      </Stack>
      <TableContainer
        className={'table-container'}
        variant='outlined'
        ref={parentRef}
      >
        <StyledTable
          aria-labelledby={'table-title'}
          stickyHeader
          borderAxis="x"
          hoverRow
          size={'sm'}
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
                      ...((header.column.columnDef.meta as { flex?: number | undefined })?.flex && {
                        minWidth: header.column.getSize(),
                        flex: (header.column.columnDef.meta as { flex?: number | undefined })?.flex
                      }),
                      ...getCommonPinningStyles(header.column, true)
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

ResourceTableContainer.displayName = 'ResourceTableContainer';

export default ResourceTableContainer;
