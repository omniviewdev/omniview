import React, { useState } from 'react';

// Material-ui
import {
  Alert,
  Box,
  Link,
  Sheet,
  Table,
  Typography,
} from '@mui/joy';

import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

// Tanstack/react-table
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
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
import MemoizedRow from './MemoizedRow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useResources } from '@omniviewdev/runtime';
import { LuCircleAlert } from 'react-icons/lu';

export type Memoizer = string | string[] | ((data: any) => string);
export type IdAccessor = string | ((data: any) => string);

export type Props = {
  /**
   * Column defenition for the table.
   */
  columns: Array<ColumnDef<any>>;

  /**
   * The available namespaces for viewing, if the resource is namespaced.
   */
  namespaces?: string[];

  /**
   * The visibility state to start with for the columns.
   */
  initialColumnVisibility?: VisibilityState;

  /**
   * The ID accessor for the data.
   */
  idAccessor: IdAccessor;

  /**
   * Namespace accessor
   */
  namespaceAccessor?: string;

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
   * ID for the plugin.
   */
  pluginID: string;

  /**
  * ID for the connection.
  */
  connectionID: string;

  /**
   * The resource key that uniquely identifies the resource.
   */
  resourceKey: string;

  /**
   * Search string for the table.
   */
  search?: string;
};

const idAccessorResolver = (data: any, accessor: IdAccessor): string => {
  switch (typeof accessor) {
    case 'function':
      return accessor(data);
    case 'string':
      return get(data, accessor);
    default:
      throw new Error('Invalid ID accessor');
  }
};

export const namespaceFilter: FilterFn<any> = (row, columnId, value: string[]) => {
  // If not selected namespaces, return true
  if (!value?.length) {
    return true;
  }

  return value.includes(row.getValue(columnId));
};


/**
  * Render a generic resource table with sorting, filtering, column visibility and row selection.
  * Use this component to display a generic table for any Kubernetes resource using tanstack/react-table.
  *
  * @param columns - The columns to display in the table.
  * @param data - The data to display in the table.
  * @returns The resource table.
  */
const ResourceTableContainer: React.FC<Props> = ({
  columns,
  idAccessor,
  namespaceAccessor,
  memoizer,
  pluginID,
  connectionID,
  resourceKey,
  initialColumnVisibility,
  search,
}) => {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([{ id: 'namespace', value: [] }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // we have to use layout effect to set the column visibility before the table is repainted, use effect will cause a flicker
  // also can't just put it in the initial state because it will cause an issue with table render as well
  React.useLayoutEffect(() => {
    // check local storage to see if they've saved this
    const storedColumnVisibility = window.localStorage.getItem(`${pluginID}-${connectionID}-${resourceKey}-column-visibility`);
    if (storedColumnVisibility && initialColumnVisibility) {
      const current = JSON.parse(storedColumnVisibility);

      // make sure any new filters are added if they weren't there before
      Object.entries(initialColumnVisibility).forEach(([key, value]) => {
        if (!current.hasOwnProperty(key)) {
          current[key] = value;
        }
      });

      setColumnVisibility(current);
    } else if (initialColumnVisibility) {
      setColumnVisibility(initialColumnVisibility);
    }
  }, [initialColumnVisibility]);

  React.useEffect(() => {
    let visibility = JSON.stringify(columnVisibility);
    // save changes to local storage
    if (visibility !== '{}') {
      window.localStorage.setItem(`${pluginID}-${connectionID}-${resourceKey}-column-visibility`, visibility);
    }
  }, [columnVisibility]);

  const { resources } = useResources({ pluginID, connectionID, resourceKey });

  const table = useReactTable({
    data: resources.data?.result || [],
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    // GetPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => idAccessorResolver(row, idAccessor),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: search,
    },
    defaultColumn: {
      minSize: 0,
      size: Number.MAX_SAFE_INTEGER,
      maxSize: Number.MAX_SAFE_INTEGER,
    },
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
  });

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
    <Sheet
      className={'table-container'}
      variant='outlined'
      ref={parentRef}
      sx={{
        backgroundColor: 'inherit',
        width: '100%',
        borderRadius: '4px',
        flex: 1,
        overflow: 'scroll',
        minHeight: 0,
        // TODO: make this a prop
        // Hide the scrollbars
        '&::-webkit-scrollbar': {
          display: 'none',
        },
        scrollbarWidth: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <Table
        aria-labelledby={'table-title'}
        stickyHeader
        hoverRow
        size={'sm'}
        sx={{
          display: 'grid',
          '--TableCell-headBackground':
            'var(--joy-palette-background-level1)',
          '--Table-headerUnderlineThickness': '1px',
          '--TableRow-hoverBackground':
            'var(--joy-palette-background-level2)',
          '--TableCell-paddingY': '0px',
          '--TableCell-paddingX': '8px',
          '--TableCell-height': '36px',
          WebkitUserSelect: 'none',
        }}
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
                  style={{
                    alignContent: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    // paddingTop: '12px', 
                    // paddingBottom: '12px', 
                    width: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    minWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    maxWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                    flex: 1,
                  }}
                >
                  {header.column.getCanSort()
                    ? <Link
                      underline='none'
                      color='primary'
                      component='button'
                      onClick={header.column.getToggleSortingHandler()}
                      fontWeight='lg'
                      endDecorator={header.column.getIsSorted() && <ArrowDropDownIcon />}
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
              <MemoizedRow
                key={row.id}
                pluginID={pluginID}
                connectionID={connectionID}
                resourceID={row.id}
                resourceKey={resourceKey}
                namespace={namespaceAccessor ? get(row.original, namespaceAccessor) : undefined}
                row={row}
                memoizer={memoizer}
                virtualizer={virtualizer}
                virtualRow={virtualRow}
                isSelected={rowSelection[row.id]}
                columnVisibility={JSON.stringify(columnVisibility)}
              />
            );
          })}
        </tbody>
      </Table>
    </Sheet>
  );
};

ResourceTableContainer.displayName = 'ResourceTableContainer';
ResourceTableContainer.whyDidYouRender = true;

export default ResourceTableContainer;
