import React, { useState } from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import Link from '@mui/joy/Link';
import Sheet from '@mui/joy/Sheet';
import Table from '@mui/joy/Table';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import Stack from '@mui/joy/Stack';

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
} from '@tanstack/react-table';
import get from 'lodash.get';

// Project imports
import NamespaceSelect from '@/components/selects/NamespaceSelect';
import { DebouncedInput } from './DebouncedInput';
import { RowContainer } from './RowContainer';
import { plural } from '@/utils/language';

export type Memoizer = string | string[] | ((data: any) => string);
export type IdAccessor = string | ((data: any) => string);

export type Props = {
  /**
   * Column defenition for the table.
   */
  columns: Array<ColumnDef<any>>;

  /**
   * The data coming in
   */
  data: any[];

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
};

const idAccessorResolver = (data: any, accessor: IdAccessor): string => {
  console.log('data', data, 'accessor', accessor);
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
  data,
  idAccessor,
  namespaceAccessor,
  memoizer,
  pluginID, 
  connectionID, 
  resourceKey,
}) => {

  // Monkey patch the namespace column so it uses the namespace filter
  const namespaced = columns.some(c => c.id === 'namespace');
  if (namespaced) {
    columns.find(c => c.id === 'namespace')!.filterFn = namespaceFilter;
  }

  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(namespaced ? [
    { id: 'namespace', value: [] },
  ] : []);

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState({});

  const setNamespaces = (namespaces: string[]) => {
    setColumnFilters(prev => {
      const namespaceFilter = prev.find(f => f.id === 'namespace');
      if (namespaceFilter) {
        return prev.map(f => {
          if (f.id === 'namespace') {
            return { ...f, value: namespaces };
          }

          return f;
        });
      }

      return prev;
    });
  };

  const [search, setSearch] = useState<string>('');

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    // GetPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => {
      const id = idAccessorResolver(row, idAccessor);
      console.log('id', id);
      return id;
    },
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

  const placeHolderText = () => {
    const keyparts = resourceKey.split('::'); 
    const resource = plural(keyparts[keyparts.length - 1]);
    return `Search ${data.length} ${resource}...`;
  };

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', p: 1, gap: 1, minHeight: 0 }} >
      <Stack direction='row' justifyContent={'space-between'} className='NamespaceAndSearch' sx={{ width: '100%' }}>
        <DebouncedInput
          value={search ?? ''}
          onChange={value => {
            setSearch(String(value));
          }}
          placeholder={placeHolderText()}
        />
        {namespaced && 
          <NamespaceSelect 
            namespaces={columnFilters.find(f => f.id === 'namespace')?.value as string[] || []} 
            setNamespaces={setNamespaces} 
          />
        }
      </Stack>
      <Sheet
        className={'table-container'}
        variant='outlined'
        sx={{
          width: '100%',
          borderRadius: 'sm',
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
          sx={{
            '--TableCell-headBackground':
              'var(--joy-palette-background-level1)',
            '--Table-headerUnderlineThickness': '1px',
            '--TableRow-hoverBackground':
              'var(--joy-palette-background-level1)',
            '--TableCell-paddingY': '2px',
            '--TableCell-paddingX': '8px',
            WebkitUserSelect: 'none',
          }}
        >
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} style={{ cursor: 'pointer' }}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} style={{
                    alignContent: 'center', paddingTop: '12px', paddingBottom: '12px', width: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                  }} >
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
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <MemoizedRow
                key={row.id}
                pluginID={pluginID}
                connectionID={connectionID}
                resourceID={row.id}
                resourceKey={resourceKey}
                namespace={namespaceAccessor ? get(row.original, namespaceAccessor) : undefined}
                row={row}
                memoizer={memoizer}
              />
            ))}
          </tbody>
        </Table>
      </Sheet>
    </Box>
  );
};

/**
* Calculate the memo key based on the memoizer function provided, fallback to default if not provided.
*/
const calcMemoKey = (data: any, memoizer?: Memoizer) => {
  if (typeof memoizer === 'function') {
    return memoizer(data);
  }

  if (Array.isArray(memoizer)) {
    return memoizer.map(key => get(data, key)).join('-');
  }

  if (typeof memoizer === 'string') {
    return get(data, memoizer);
  }

  // memoizer is not provided, so there isn't really a way we can memoize this.
  return null;
};

const MemoizedRow = React.memo(RowContainer, (prev, next) => {
  return calcMemoKey(prev.row.original, prev.memoizer) === calcMemoKey(next.row.original, next.memoizer);
});

ResourceTableContainer.displayName = 'ResourceTableContainer';
ResourceTableContainer.whyDidYouRender = true;
export default ResourceTableContainer;
