import React, { useState } from 'react';

// Material-ui
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

// Tanstack/react-table
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

// Project imports
// import NamespaceSelect from '@/components/selects/NamespaceSelect';
import ResourceTableRow from './ResourceTableRow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useResources, DrawerComponent, useRightDrawer } from '@omniviewdev/runtime';
import { LuCircleAlert } from 'react-icons/lu';
import { plural } from '../../../utils/language';
import { DebouncedInput } from '../../tables/DebouncedInput';
import NamespaceSelect from '../../tables/NamespaceSelect';
import ColumnFilter from '../../tables/ColumnFilter';
import { getCommonPinningStyles } from './utils';
import { ColumnMeta } from './types';
import { useDynamicResourceColumns } from '../../tables/ColumnFilter/useDynamicResourceColumns';
import { useStoredState } from '../hooks/useStoredState';

export type Memoizer = string | string[] | ((data: any) => string);

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
  /**
   * The ID of the connection which we are using to fetch the resources
   */
  connectionID: string;

  /**
   * The key that uniquely identifies the resource (e.g core::v1::Pod)
   */
  resourceKey: string;

  /**
   * Column defenition for the table.
   */
  columns: Array<ColumnDef<T> & ColumnMeta>;

  /**
   * The ID accessor for the data.
   */
  idAccessor: string;

  /**
   * Memoizer is a function that takes in the data and returns a key or hash
   * to determine if the data has changed or not. If provided, it will be used
   * to optimize rerenders of columns.
   *
   * This can either be a single string key accessor, an array of string key accessors,
   * of a function that takes in the data and returns a key. If provided as a function,
   * limit the comparison work to only what is required.
   */
  memoizer?: Memoizer;

  /**
   * Drawer component to display with the data upon clicking the row. If this is not provided,
   * then the drawer will not open on the right upon click.
   */
  drawer?: DrawerComponent
};


// const idAccessorResolver = (data: any, accessor: IdAccessor): string => {
//   switch (typeof accessor) {
//     case 'function':
//       return accessor(data);
//     case 'string':
//       return get(data, accessor);
//     default:
//       throw new Error('Invalid ID accessor');
//   }
// };

const defaultData: any[] = []

/**
  * Render a generic resource table with sorting, filtering, column visibility and row selection.
  * Use this component to display a generic table for any Kubernetes resource using tanstack/react-table.
  *
  * @returns The resource table.
  */
const ResourceTableContainer: React.FC<Props> = ({
  connectionID,
  resourceKey,
  columns,
  // idAccessor,
  memoizer,
  drawer,
}) => {
  console.log(resourceKey, 'ResourceTableContainer', 'rendered');

  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnVisibility, setColumnVisibility] = useStoredState<VisibilityState>(`kubernetes-${connectionID}-${resourceKey}-column-visibility`, {});
  const [columnFilters, setColumnFilters] = useStoredState<ColumnFiltersState>(`kubernetes-${connectionID}-${resourceKey}-column-filters`, [{ id: 'namespace', value: [] }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [search, setSearch] = useState<string>('');
  const { openDrawer } = useRightDrawer()

  /** Filtering behavior */
  const [filterAnchor, setFilterAnchor] = React.useState<undefined | HTMLElement>(undefined);
  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    setFilterAnchor(filterAnchor ? undefined : event.currentTarget);
  };
  const handleFilterClose = () => {
    setFilterAnchor(undefined);
  };

  /** Row Clicking */
  const onRowClick = React.useCallback((id: string, data: any) => {
    console.log("onRowClick called", { id, data })
    if (drawer === undefined) {
      /** nothing to do */
      return
    }
    openDrawer(drawer, {
      data,
      resource: {
        id,
        key: resourceKey,
        connectionID
      }
    })
  }, [drawer])

  /**
  * Set the namespaces filter
  */
  const setNamespaces = (value: string[]) => {
    setColumnFilters((prev) => {
      const namespaceFilter = prev.find(f => f.id === 'namespace');
      if (namespaceFilter) {
        return prev.map(f => f.id === 'namespace' ? { ...f, value } : f);
      }

      return [...prev, { id: 'namespace', value }];
    });
  };

  const { resources } = useResources({ pluginID: 'kubernetes', connectionID, resourceKey, idAccessor: 'metadata.uid' });
  const {
    labels,
    setLabels,
    annotations,
    setAnnotations,
    columnDefs,
  } = useDynamicResourceColumns({ connectionID, resourceKey })

  const handleLabels = (vals: Record<string, boolean>) => {
    setLabels((prev) => ({ ...prev, ...vals }))
  }

  const handleAnnotations = (vals: Record<string, boolean>) => {
    setAnnotations((prev) => ({ ...prev, ...vals }))
  }

  const table = useReactTable({
    data: resources.data?.result || defaultData,
    columns: [...columns, ...columnDefs],
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    // GetPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => get(row, 'metadata.uid'),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: search,
      columnPinning: { left: ['select'], right: ['menu'] }
    },
    // defaultColumn: {
    //   minSize: 0,
    //   size: Number.MAX_SAFE_INTEGER,
    //   maxSize: Number.MAX_SAFE_INTEGER,
    // },
  });

  const { rows } = table.getRowModel();

  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    // Actual height of each row
    estimateSize: React.useCallback(() => 36, []),
    // the number of items *above and below to render
    overscan: 10,
    // // Measure dynamic row height, except in firefox because it measures table border height incorrectly
    // measureElement:
    //   typeof window !== 'undefined'
    //     && !navigator.userAgent.includes('Firefox')
    //     ? element => element?.getBoundingClientRect().height
    //     : undefined,
  });

  const placeHolderText = () => {
    const keyparts = resourceKey.split('::');
    const resource = plural(keyparts[keyparts.length - 1]);

    const count = resources.data?.result.length

    return `Search ${count ? `${count} ` : ''}${resource}...`;
  };

  if (resources.isError) {
    let errstring = resources.error?.toString();
    console.error('Failed loading resources', errstring);
    let error = <p>{'An error occurred while loading resources'}</p>;
    if (errstring?.includes('could not find the requested resource')) {
      error = <div>
        <span>{'The resource group could not be found. This may be the result of'}</span>
        <ol>
          <li>{'The resource group does not exist (for this connection)'}</li>
          <li>{'The resource group has been deleted (for this connection)'}</li>
          <li>{'You do not have permission to access the resource group'}</li>
        </ol>
      </div>;
    }

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
          {error}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', p: 0.75, gap: 0.75, minHeight: 0 }} >
      <Stack direction='row' justifyContent={'space-between'} className='NamespaceAndSearch' sx={{ width: '100%' }}>
        <DebouncedInput
          value={search ?? ''}
          onChange={value => {
            setSearch(String(value));
          }}
          placeholder={placeHolderText()}
        />
        <Stack direction='row' gap={1}>
          <NamespaceSelect
            connectionID={connectionID}
            selected={columnFilters.find(f => f.id === 'namespace')?.value as string[] || []}
            setNamespaces={setNamespaces}
          />
          <ColumnFilter
            labels={labels}
            setLabels={handleLabels}
            annotations={annotations}
            setAnnotations={handleAnnotations}
            anchorEl={filterAnchor}
            onClose={handleFilterClose}
            columns={table.getAllFlatColumns()}
            onClick={handleFilterClick}
          />
        </Stack>
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
                      // paddingTop: '12px', 
                      // paddingBottom: '12px', 
                      width: header.getSize(),
                      ...((header.column.columnDef.meta as { flex?: number | undefined })?.flex && {
                        minWidth: header.column.getSize(),
                        flex: (header.column.columnDef.meta as { flex?: number | undefined })?.flex
                      }),
                      // minWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                      // maxWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
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
          <tbody
            style={{
              display: 'grid',
              height: `${virtualizer.getTotalSize()}px`, // Tells scrollbar how big the table is
              position: 'relative', // Needed for absolute positioning of rows
            }}
          >
            {virtualizer.getVirtualItems().map(virtualRow => {
              const row = rows[virtualRow.index];
              return (
                <ResourceTableRow
                  key={row.id}
                  connectionID={connectionID}
                  resourceID={row.id}
                  resourceKey={resourceKey}
                  row={row}
                  memoizer={memoizer}
                  virtualizer={virtualizer}
                  virtualRow={virtualRow}
                  isSelected={rowSelection[row.id]}
                  columnVisibility={JSON.stringify({ columnVisibility, customCols: columnDefs.length })}
                  onRowClick={onRowClick}
                />
              );
            })}
          </tbody>
        </StyledTable>
      </TableContainer>
    </Box>
  );
};

ResourceTableContainer.displayName = 'ResourceTableContainer';
ResourceTableContainer.whyDidYouRender = true;

export default ResourceTableContainer;
